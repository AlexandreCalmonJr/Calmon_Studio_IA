import type { Request } from 'express';
import {
  resolveExternalCredentialForRequest,
  serverState,
} from '../serverState.ts';
import { generateStudioImage, startStudioVideoJob } from '../mediaEngine.ts';
import {
  generateSpreadsheetSpec,
  renderSpreadsheetToXlsxBuffer,
} from '../spreadsheetServer.ts';
import { detectNaturalMediaIntent } from '../../src/services/multiOrchestrator.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

export interface ChatMediaAssetPayload {
  kind: 'image' | 'video' | 'spreadsheet';
  id: string;
  title: string;
  url: string;
  secondary_url?: string;
  status?: 'running' | 'completed' | 'failed';
  status_url?: string;
  mime_type: string;
  model_used?: string;
}

/**
 * Detecta intenção natural de geração de imagem, vídeo ou planilha no chat
 * (sem necessidade de comandos /imagem, /video, /planilha) e executa com
 * o provedor disponível (Gemini ou chave configurada do usuário).
 */
export async function resolveNaturalChatMedia(input: {
  req: Request;
  store: LocalSqliteBrainStore;
  ownerUserId: string;
  prompt: string;
  requestedModel?: string;
}): Promise<ChatMediaAssetPayload[]> {
  const intent = detectNaturalMediaIntent(input.prompt);
  if (!intent) return [];

  if (intent === 'image') {
    try {
      const externalCredential = resolveExternalCredentialForRequest(
        input.req,
        input.store,
        input.ownerUserId,
        input.requestedModel
      );
      const asset = await generateStudioImage({
        prompt: input.prompt,
        model: input.requestedModel,
        externalCredential,
      });
      serverState.imageGallery.unshift(asset);
      if (serverState.imageGallery.length > 24) serverState.imageGallery.pop();
      return [
        {
          kind: 'image',
          id: asset.id,
          title: 'Imagem Gerada',
          url: asset.dataUrl,
          mime_type: asset.mimeType,
          model_used: asset.model,
        },
      ];
    } catch {
      // Se não houver chave raster configurada, o chatRouter faz fallback para SVG estruturado (.png)
      return [];
    }
  }

  if (intent === 'spreadsheet') {
    try {
      const externalCredential = resolveExternalCredentialForRequest(
        input.req,
        input.store,
        input.ownerUserId,
        input.requestedModel
      );
      const spec = await generateSpreadsheetSpec({
        prompt: input.prompt,
        useAi: Boolean(externalCredential || (process.env.GEMINI_API_KEY || '').trim()),
        externalCredential,
      });
      const xlsxBuffer = await renderSpreadsheetToXlsxBuffer(spec);
      serverState.spreadsheetStore.set(spec.id, { spec, xlsxBuffer });
      if (serverState.spreadsheetStore.size > 25) {
        const oldestKey = serverState.spreadsheetStore.keys().next().value;
        if (oldestKey) serverState.spreadsheetStore.delete(oldestKey);
      }
      return [
        {
          kind: 'spreadsheet',
          id: spec.id,
          title: spec.title,
          url: `/api/v1/spreadsheets/${spec.id}/download?format=xlsx`,
          secondary_url: `/api/v1/spreadsheets/${spec.id}/download?format=csv`,
          mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          model_used: 'ExcelJS',
        },
      ];
    } catch {
      return [];
    }
  }

  if (intent === 'video') {
    try {
      const externalCredential = resolveExternalCredentialForRequest(
        input.req,
        input.store,
        input.ownerUserId,
        input.requestedModel
      );
      const job = startStudioVideoJob(serverState.videoJobStore, {
        prompt: input.prompt,
        model: input.requestedModel,
        externalCredential,
      });
      if (serverState.videoJobStore.size > 12) {
        const oldestKey = serverState.videoJobStore.keys().next().value;
        if (oldestKey) serverState.videoJobStore.delete(oldestKey);
      }
      return [
        {
          kind: 'video',
          id: job.id,
          title: 'Vídeo em Geração',
          url: `/api/v1/media/videos/${job.id}/file`,
          status_url: `/api/v1/media/videos/${job.id}`,
          status: job.status,
          mime_type: 'video/mp4',
          model_used: job.model,
        },
      ];
    } catch {
      return [];
    }
  }

  return [];
}
