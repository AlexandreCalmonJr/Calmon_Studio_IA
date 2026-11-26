import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import {
  EXTERNAL_PROVIDERS,
  validateProviderBaseUrl,
  type ResolvedExternalCredential,
} from './providerEngine.ts';
import { extractProviderHttpError, fetchWithTimeout } from './providerHttpHelpers.ts';

export type ImageModelId = string;
export type ImageAspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type ImageResolution = '1K' | '2K' | '4K';

const GEMINI_IMAGE_MODELS = new Set(['gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1']);

const ASPECT_TO_SIZE: Record<ImageAspectRatio, string> = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
  '4:3': '1024x768',
  '3:4': '768x1024',
};

export interface GeneratedImageAsset {
  id: string;
  kind: 'image';
  prompt: string;
  model: ImageModelId;
  aspectRatio: ImageAspectRatio;
  imageSize?: ImageResolution;
  mimeType: string;
  dataUrl: string;
  caption?: string;
  editedFromReference: boolean;
  createdAt: string;
}

export interface VideoGenerationJob {
  id: string;
  kind: 'video';
  prompt: string;
  model: string;
  aspectRatio: '16:9' | '9:16';
  duration: '5s' | '8s' | '10s';
  resolution: '720p' | '1080p';
  status: 'running' | 'completed' | 'failed';
  progressMessage: string;
  interactionId?: string;
  previousInteractionId?: string;
  videoUrl?: string;
  mimeType?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error(
      'Chave GEMINI_API_KEY não configurada no servidor. Selecione ou configure sua chave de API faturada em Settings > Secrets para gerar imagens e vídeos.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function formatGeminiMediaError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || 'Erro desconhecido');
  if (/PERMISSION_DENIED|API_KEY_INVALID|403|401/i.test(raw)) {
    return `A chave de API não tem permissão para este modelo multimodal. Verifique sua chave faturada em Settings > Secrets. (${raw.slice(0, 180)})`;
  }
  if (/RESOURCE_EXHAUSTED|429|quota/i.test(raw)) {
    return `Limite de cota atingido para geração multimodal. Modelos de imagem e vídeo exigem uma chave de API com faturamento ativo em Settings > Secrets. (${raw.slice(0, 180)})`;
  }
  return raw;
}

async function generateExternalProviderImage(input: {
  prompt: string;
  model: string;
  aspectRatio: ImageAspectRatio;
  credential: ResolvedExternalCredential;
}): Promise<GeneratedImageAsset> {
  const { credential } = input;
  const meta = EXTERNAL_PROVIDERS[credential.provider];
  const urlCheck = validateProviderBaseUrl(credential.provider, credential.baseUrl);
  if (!urlCheck.valid) {
    throw new Error(urlCheck.error || `Endpoint inválido para ${meta.name}.`);
  }

  const chosenModel = input.model && !GEMINI_IMAGE_MODELS.has(input.model)
    ? input.model
    : credential.model || 'dall-e-3';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${credential.apiKey}`,
    'User-Agent': 'jarvis-ai-hub',
  };
  if (credential.provider === 'openrouter') {
    headers['X-Title'] = 'Calmon Studio';
  }

  const response = await fetchWithTimeout(
    `${urlCheck.normalizedUrl}/images/generations`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: chosenModel,
        prompt: input.prompt,
        n: 1,
        size: ASPECT_TO_SIZE[input.aspectRatio] || '1024x1024',
        response_format: 'b64_json',
      }),
    },
    60000
  );

  if (!response.ok) {
    const detail = await extractProviderHttpError(response, credential.apiKey, 200);
    throw new Error(`${meta.shortLabel} (${chosenModel}) falhou ao gerar imagem: ${detail}`);
  }

  const json = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  };
  const first = json?.data?.[0];
  let dataUrl = '';
  if (first?.b64_json) {
    dataUrl = `data:image/png;base64,${first.b64_json}`;
  } else if (first?.url) {
    dataUrl = first.url;
  }

  if (!dataUrl) {
    throw new Error(`O modelo ${chosenModel} (${meta.shortLabel}) não retornou dados de imagem.`);
  }

  return {
    id: `img_${crypto.randomBytes(5).toString('hex')}`,
    kind: 'image',
    prompt: input.prompt,
    model: chosenModel,
    aspectRatio: input.aspectRatio,
    mimeType: 'image/png',
    dataUrl,
    caption: first?.revised_prompt || `Gerado via ${meta.shortLabel} (${chosenModel})`,
    editedFromReference: false,
    createdAt: new Date().toISOString(),
  };
}

export async function generateStudioImage(input: {
  prompt: string;
  model?: ImageModelId;
  aspectRatio?: ImageAspectRatio;
  imageSize?: ImageResolution;
  referenceImageBase64?: string;
  referenceMimeType?: string;
  externalCredential?: ResolvedExternalCredential | null;
}): Promise<GeneratedImageAsset> {
  const prompt = (input.prompt || '').trim();
  if (!prompt) {
    throw new Error('Descreva a imagem ou a edição desejada antes de gerar.');
  }

  const aspectRatio: ImageAspectRatio = ['1:1', '16:9', '9:16', '4:3', '3:4'].includes(
    input.aspectRatio || ''
  )
    ? (input.aspectRatio as ImageAspectRatio)
    : '1:1';

  const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const requestedModel = String(input.model || '').trim();
  const wantsExternal =
    Boolean(input.externalCredential) &&
    ((requestedModel && !GEMINI_IMAGE_MODELS.has(requestedModel)) || !hasGeminiKey);

  if (wantsExternal && input.externalCredential) {
    return generateExternalProviderImage({
      prompt,
      model: requestedModel || input.externalCredential.model,
      aspectRatio,
      credential: input.externalCredential,
    });
  }

  if (!hasGeminiKey) {
    throw new Error(
      'Nenhuma chave de API com suporte a imagem configurada. Configure GEMINI_API_KEY ou salve uma chave de provedor (OpenAI, xAI, Custom) em Configurações > Chaves de API.'
    );
  }

  const ai = getGeminiClient();
  const model: ImageModelId =
    input.model === 'gemini-nano-banana-2.1'
      ? 'gemini-nano-banana-2.1'
      : 'gemini-3.1-flash-lite-image';

  const imageSize: ImageResolution | undefined =
    model === 'gemini-nano-banana-2.1'
      ? (['1K', '2K', '4K'].includes(input.imageSize || '') ? (input.imageSize as ImageResolution) : '1K')
      : undefined;

  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [];
  const hasReference = Boolean(input.referenceImageBase64 && input.referenceImageBase64.trim().length > 20);
  if (hasReference) {
    const cleanBase64 = String(input.referenceImageBase64)
      .replace(/^data:[^;]+;base64,/, '')
      .trim();
    parts.push({
      inlineData: {
        data: cleanBase64,
        mimeType: input.referenceMimeType || 'image/png',
      },
    });
  }
  parts.push({ text: prompt });

  const imageConfig: Record<string, string> = { aspectRatio };
  if (imageSize) {
    imageConfig.imageSize = imageSize;
  }

  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts },
      config: { imageConfig },
    });

    let imageBase64 = '';
    let mimeType = 'image/png';
    const textNotes: string[] = [];

    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || 'image/png';
      } else if (part.text) {
        textNotes.push(part.text.trim());
      }
    }

    if (!imageBase64) {
      throw new Error(
        textNotes.join(' ') ||
          'O modelo concluiu sem retornar dados de imagem. Tente ajustar o prompt com mais detalhes visuais.'
      );
    }

    return {
      id: `img_${crypto.randomBytes(5).toString('hex')}`,
      kind: 'image',
      prompt,
      model,
      aspectRatio,
      imageSize,
      mimeType,
      dataUrl: `data:${mimeType};base64,${imageBase64}`,
      caption: textNotes.join(' ').trim() || undefined,
      editedFromReference: hasReference,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    throw new Error(formatGeminiMediaError(err));
  }
}

export interface VideoJobStoreEntry {
  job: VideoGenerationJob;
  buffer?: Buffer;
}

export function startStudioVideoJob(
  store: Map<string, VideoJobStoreEntry>,
  input: {
    prompt: string;
    model?: string;
    aspectRatio?: '16:9' | '9:16';
    duration?: '5s' | '8s' | '10s';
    resolution?: '720p' | '1080p';
    referenceImageBase64?: string;
    referenceMimeType?: string;
    previousInteractionId?: string;
    externalCredential?: ResolvedExternalCredential | null;
  }
): VideoGenerationJob {
  const prompt = (input.prompt || '').trim();
  if (!prompt) {
    throw new Error('Descreva a cena do vídeo antes de iniciar a geração.');
  }

  const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim());
  const requestedModel = String(input.model || '').trim();
  const wantsExternal =
    Boolean(input.externalCredential) &&
    ((requestedModel && requestedModel !== 'gemini-omni-1.2-flash') || !hasGeminiKey);

  if (!wantsExternal && !hasGeminiKey) {
    throw new Error(
      'Nenhuma chave de API configurada para vídeo. Salve uma chave de provedor em Configurações > Chaves de API ou configure GEMINI_API_KEY.'
    );
  }

  const effectiveModel = wantsExternal
    ? requestedModel || input.externalCredential!.model || 'sora-2'
    : 'gemini-omni-1.2-flash';

  const id = `vid_${crypto.randomBytes(5).toString('hex')}`;
  const aspectRatio: '16:9' | '9:16' = input.aspectRatio === '9:16' ? '9:16' : '16:9';
  const duration: '5s' | '8s' | '10s' =
    input.duration === '5s' || input.duration === '8s' || input.duration === '10s'
      ? input.duration
      : '8s';
  const resolution: '720p' | '1080p' = input.resolution === '1080p' ? '1080p' : '720p';

  const job: VideoGenerationJob = {
    id,
    kind: 'video',
    prompt,
    model: effectiveModel,
    aspectRatio,
    duration,
    resolution,
    status: 'running',
    progressMessage: wantsExternal
      ? `Enviando geração de vídeo para ${input.externalCredential!.label || input.externalCredential!.provider} (${effectiveModel})...`
      : input.previousInteractionId
        ? 'Estendendo cena anterior no Diretor de Vídeos (Gemini Omni Flash)...'
        : 'Renderizando vídeo em alta fluidez com Gemini Omni Flash...',
    previousInteractionId: input.previousInteractionId,
    createdAt: new Date().toISOString(),
  };

  store.set(id, { job });

  if (wantsExternal && input.externalCredential) {
    const cred = input.externalCredential;
    void (async () => {
      try {
        const meta = EXTERNAL_PROVIDERS[cred.provider];
        const urlCheck = validateProviderBaseUrl(cred.provider, cred.baseUrl);
        if (!urlCheck.valid) {
          throw new Error(urlCheck.error || `Endpoint inválido para ${meta.name}.`);
        }
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cred.apiKey}`,
          'User-Agent': 'jarvis-ai-hub',
        };
        if (cred.provider === 'openrouter') headers['X-Title'] = 'Calmon Studio';

        const response = await fetchWithTimeout(
          `${urlCheck.normalizedUrl}/videos/generations`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: effectiveModel,
              prompt,
              aspect_ratio: aspectRatio,
              duration: Number(duration.replace('s', '')) || 8,
              resolution,
            }),
          },
          120_000
        );

        if (!response.ok) {
          const detail = await extractProviderHttpError(response, cred.apiKey, 200);
          throw new Error(`${meta.shortLabel} (${effectiveModel}) retornou ${detail} em /videos/generations.`);
        }

        const json = (await response.json()) as {
          data?: Array<{ b64_json?: string; url?: string }>;
          url?: string;
        };
        const b64 = json?.data?.[0]?.b64_json;
        const remoteUrl = json?.data?.[0]?.url || json?.url;

        let videoBuffer: Buffer | undefined;
        if (b64) {
          videoBuffer = Buffer.from(b64, 'base64');
        } else if (remoteUrl) {
          const fileRes = await fetchWithTimeout(remoteUrl, { method: 'GET' }, 60_000);
          if (!fileRes.ok) {
            throw new Error(`Não foi possível baixar o vídeo gerado (${fileRes.status}).`);
          }
          videoBuffer = Buffer.from(await fileRes.arrayBuffer());
        } else {
          throw new Error(`O modelo ${effectiveModel} não retornou dados de vídeo.`);
        }

        const entry = store.get(id);
        if (entry) {
          entry.buffer = videoBuffer;
          entry.job.status = 'completed';
          entry.job.mimeType = 'video/mp4';
          entry.job.videoUrl = `/api/v1/media/videos/${id}/file`;
          entry.job.progressMessage = `Vídeo pronto via ${meta.shortLabel} (${effectiveModel}).`;
          entry.job.completedAt = new Date().toISOString();
        }
      } catch (err) {
        const entry = store.get(id);
        if (entry) {
          entry.job.status = 'failed';
          entry.job.error = err instanceof Error ? err.message : 'Falha ao gerar vídeo no provedor externo.';
          entry.job.progressMessage = entry.job.error;
          entry.job.completedAt = new Date().toISOString();
        }
      }
    })();
    return job;
  }

  const ai = getGeminiClient();

  // Run Omni Flash via Interactions API asynchronously so the HTTP route returns immediately for live progress polling
  void (async () => {
    try {
      const hasRefImage = Boolean(
        input.referenceImageBase64 && input.referenceImageBase64.trim().length > 20
      );

      const interactionInput: any = hasRefImage
        ? [
            {
              type: 'image',
              mime_type: input.referenceMimeType || 'image/png',
              data: String(input.referenceImageBase64).replace(/^data:[^;]+;base64,/, '').trim(),
            },
            {
              type: 'text',
              text: prompt,
            },
          ]
        : prompt;

      const payload: Record<string, any> = {
        model: 'gemini-omni-1.2-flash',
        input: interactionInput,
        background: false,
        store: true,
        stream: false,
        response_format: {
          type: 'video',
          aspect_ratio: aspectRatio,
          duration,
          resolution,
        },
      };

      if (input.previousInteractionId) {
        payload.previous_interaction_id = input.previousInteractionId;
      }

      const interaction = await (ai.interactions as any).create(payload, { timeout: 300000 });
      const videoPart = interaction?.output_video;

      if (!videoPart || (!videoPart.data && !videoPart.uri)) {
        throw new Error('O motor de vídeo concluiu a operação sem retornar arquivo MP4.');
      }

      let videoBuffer: Buffer | undefined;
      if (videoPart.data) {
        videoBuffer = Buffer.from(videoPart.data, 'base64');
      } else if (videoPart.uri) {
        const res = await fetch(videoPart.uri);
        if (!res.ok) {
          throw new Error(`Não foi possível baixar o vídeo gerado (${res.status}).`);
        }
        videoBuffer = Buffer.from(await res.arrayBuffer());
      }

      const entry = store.get(id);
      if (entry) {
        entry.buffer = videoBuffer;
        entry.job.status = 'completed';
        entry.job.interactionId = interaction?.id;
        entry.job.mimeType = videoPart.mime_type || 'video/mp4';
        entry.job.videoUrl = `/api/v1/media/videos/${id}/file`;
        entry.job.progressMessage = 'Vídeo pronto para assistir, estender ou baixar (.mp4).';
        entry.job.completedAt = new Date().toISOString();
      }
    } catch (err) {
      const entry = store.get(id);
      if (entry) {
        entry.job.status = 'failed';
        entry.job.error = formatGeminiMediaError(err);
        entry.job.progressMessage = 'Não foi possível concluir a geração do vídeo.';
        entry.job.completedAt = new Date().toISOString();
      }
    }
  })();

  return job;
}
