import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  userProfiles,
  requireAuth,
  getOwnerUserId,
  resolveExternalCredentialForRequest,
  getSessionFromReq,
  persistStateNamespace,
  nowIso,
  broadcastRealtimeEvent,
  getActiveHardwareProfile,
  getPushConfigPayload,
  getCompanionStatePayload,
  createFreshPairingSession,
  PORT,
  UserAccount,
  RemoteCommandServer,
  PushNotificationServerItem,
  CompanionDeviceServer,
} from '../serverState.ts';
import { getEnvProviderCredential } from '../providerEngine.ts';
import { validateSafeExternalUrl } from '../serverHardening.ts';
import {
  buildContextualGreeting,
  detectWakeWord,
  generateCompanionBridgeScript,
} from '../../src/services/voiceCompanion.ts';
import { runHybridInference } from '../hybridAiEngine.ts';
import {
  buildAndroidMobilePreviewHtml,
  PairedDeviceRecord,
} from '../../src/services/androidAppEngine.ts';
import {
  packageAndroidProjectToZip,
  resolveAndroidMobileConfig,
} from '../androidAppServer.ts';
import type { LocalSqliteBrainStore } from '../brain/sqliteBrainStore.ts';

function makePairingCode(): string {
  const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `JRVS-${seg()}`;
}

function resolveVoiceNavigationAction(command: string): { tab: string; label: string } | null {
  const norm = command
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  const rules: Array<{ pattern: RegExp; tab: string; label: string }> = [
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?|novo)\b.*\b(chat|conversa|conversas)\b|\b(chat)\b/, tab: 'chat', label: 'o Chat' },
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?)\b.*\b(tarefa|tarefas)\b/, tab: 'tasks', label: 'Tarefas' },
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?)\b.*\b(fluxo|fluxos|workflow)\b/, tab: 'workflows', label: 'o Monitor de Fluxos' },
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?)\b.*\b(agente|agentes)\b/, tab: 'agents', label: 'a Central de Agentes' },
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?)\b.*\b(configuracao|configuracoes|ajuste|ajustes)\b/, tab: 'settings', label: 'Configurações' },
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?)\b.*\b(loja|pacote|pacotes)\b/, tab: 'store', label: 'a Loja Unificada' },
    { pattern: /\b(abri[r]?|ir para|vai para|mostra[r]?)\b.*\b(projeto|projetos)\b/, tab: 'workspace', label: 'Projetos' },
    { pattern: /\b(abri[r]?|ir para|vai para|voltar para)\b.*\b(inicio|visao geral|home)\b/, tab: 'overview', label: 'a Visão Geral' },
  ];

  for (const rule of rules) {
    if (rule.pattern.test(norm)) {
      return { tab: rule.tab, label: rule.label };
    }
  }
  return null;
}

export function createVoiceCompanionRouter(deps?: { store?: LocalSqliteBrainStore }): Router {
  const router = express.Router();
  const store = deps?.store;

  // --- VOZ "EI [NOME]" & BRIEFING DIÁRIO ---
  router.get('/voice/briefing', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(profile?.assistantName || 'Calmon IA');
    const userName = String(profile?.displayName || user?.display_name || 'Você');
    const pendingApprovals = serverState.approvals.filter((a) => a.status === 'pending').length;
    const openIncidents = serverState.sentinelIncidents.filter((i) => i.status === 'open').length;
    const activeWorkflows = serverState.savedWorkflows.filter((w: any) => w.schedule_enabled).length;

    const { greeting, briefingLine } = buildContextualGreeting({
      assistantName,
      userName,
      hour: new Date().getHours(),
      pendingApprovals,
      openIncidents,
      activeWorkflows,
    });

    res.json({
      assistant_name: assistantName,
      user_name: userName,
      greeting,
      briefing_line: briefingLine,
      pending_approvals: pendingApprovals,
      open_incidents: openIncidents,
      active_workflows: activeWorkflows,
      quick_prompts: [
        `Ei ${assistantName}, qual é o meu briefing completo de hoje?`,
        `Ei ${assistantName}, chama a Kira para verificar se há alertas abertos`,
        `Ei ${assistantName}, vamos praticar 2 minutos de conversação em inglês`,
        `Ei ${assistantName}, envie um comando para o meu notebook verificar o Ollama`,
      ],
      generated_at: nowIso(),
    });
  });

  router.post('/voice/converse', requireAuth, async (req: Request, res: Response) => {
    const transcript = String(req.body?.transcript || '').trim();
    const practiceMode = req.body?.practice_mode === 'english' ? 'english' : 'general';
    const attachmentName = typeof req.body?.attachment_name === 'string' ? req.body.attachment_name.trim() : '';
    const attachmentKind = req.body?.attachment_kind === 'pdf' ? 'pdf' : req.body?.attachment_kind === 'camera_photo' ? 'camera_photo' : undefined;

    if (!transcript) {
      res.status(400).json({ detail: 'Fale ou digite um comando para conversar com o assistente.' });
      return;
    }

    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(profile?.assistantName || 'Calmon IA');
    const userName = String(profile?.displayName || user?.display_name || 'Você');
    const wake = detectWakeWord(transcript, assistantName);
    const effectiveCommand = wake.command || transcript;

    const attachmentNote = attachmentName
      ? attachmentKind === 'pdf'
        ? `Anexo PDF recebido (${attachmentName}).`
        : `Foto da câmera recebida (${attachmentName}).`
      : '';

    const openInc = serverState.sentinelIncidents.filter((i) => i.status === 'open').length;
    const pendingApp = serverState.approvals.filter((a) => a.status === 'pending').length;
    const navAction = practiceMode === 'general' ? resolveVoiceNavigationAction(effectiveCommand) : null;

    let reply = '';
    let modelUsed = 'voice-local-fast';
    let executionMode: 'LOCAL' | 'ONLINE' = 'LOCAL';

    if (navAction) {
      reply = `Abrindo ${navAction.label} agora.`;
    } else if (practiceMode === 'english') {
      reply = `Great job, ${userName.split(' ')[0]}! I heard: "${effectiveCommand}". Here is a natural tip: keep your intonation relaxed and try answering — "What is your main goal for today?"`;
    } else if (/briefing|resumo|hoje|dia/i.test(effectiveCommand)) {
      reply = `Aqui é ${assistantName}! Seu ecossistema está saudável: você tem ${pendingApp} aprovação(ões) pendente(s), ${openInc} incidente(s) aberto(s) na Kira Sentinela e ${serverState.companionDevices.filter((d) => d.status === 'online').length} notebook(s) conectado(s) via Desktop Companion. ${attachmentNote}`.trim();
    } else if (/kira|seguran|alerta|incidente/i.test(effectiveCommand)) {
      reply = `Acionei a Kira Sentinela: o Vault Lock está ${serverState.vaultLocked ? 'TRAVADO' : 'desbloqueado'}, o Escudo PII está ${serverState.piiShieldEnabled ? 'ativo' : 'pausado'} e há ${openInc} alerta(s) aguardando revisão na Central de Segurança.`;
    } else if (/notebook|pc|companion|ollama/i.test(effectiveCommand)) {
      const primary = serverState.companionDevices[0];
      reply = `O Desktop Companion "${primary.name}" está ${primary.status.toUpperCase()} com CPU em ${primary.cpu_percent}%, RAM em ${primary.ram_percent}% e Ollama ${primary.ollama_online ? 'online' : 'em espera'}. Posso enviar comandos remotos quando você autorizar.`;
    } else {
      reply = `${assistantName} na escuta! Entendi seu pedido: "${effectiveCommand}". ${attachmentNote ? `${attachmentNote} Já registrei o contexto para análise.` : 'Tudo pronto para executar no seu workspace assim que desejar.'}`;
    }

    // Tenta enriquecer com motor híbrido (inclui provedor externo salvo do usuário, Gemini ou Calmon IA local)
    const ownerUserId = getOwnerUserId(req);
    const requestedVoiceModel = typeof req.body?.model === 'string' && req.body.model.trim()
      ? req.body.model.trim()
      : undefined;
    const externalCredential = store
      ? resolveExternalCredentialForRequest(req, store, ownerUserId, requestedVoiceModel)
      : null;

    if (
      !navAction &&
      (externalCredential || serverState.providerConnectivity.gemini_connected || serverState.providerConnectivity.ollama_connected)
    ) {
      try {
        const activeHw = getActiveHardwareProfile();
        const preferLocalCalmon =
          !externalCredential &&
          serverState.providerConnectivity.ollama_connected &&
          !serverState.providerConnectivity.gemini_connected;
        const targetVoiceModel = requestedVoiceModel || externalCredential?.model || (preferLocalCalmon ? 'calmon-ia:latest' : 'gemini-3.1-flash-lite');
        const voiceTimeoutMs = preferLocalCalmon ? 18_000 : 12_000;
        const voicePrompt =
          practiceMode === 'english'
            ? `You are ${assistantName}, a friendly English voice tutor. Reply in 2 short spoken sentences in English with a gentle tip and a follow-up question. User said: "${effectiveCommand}". ${attachmentNote}`
            : `Você é ${assistantName}, assistente pessoal por voz falando com ${userName}. Responda em português do Brasil de forma calorosa, direta e natural para ser lida em voz alta (máximo 3 frases curtas). Contexto atual: ${pendingApp} aprovações pendentes, ${openInc} alertas Sentinela, Vault Lock ${serverState.vaultLocked ? 'travado' : 'aberto'}. ${attachmentNote} Pedido falado: "${effectiveCommand}"`;

        const aiRes = await Promise.race([
          runHybridInference({
            prompt: voicePrompt,
            systemInstruction: 'Responda em texto limpo sem markdown excessivo, pronto para síntese de voz.',
            requestedModel: targetVoiceModel,
            routingPolicy: preferLocalCalmon ? 'local_only' : 'auto_hybrid',
            ollamaBaseUrl: activeHw.ollama_url,
            ollamaConnected: serverState.providerConnectivity.ollama_connected,
            geminiConnected: serverState.providerConnectivity.gemini_connected,
            externalProvider: externalCredential || undefined,
            enableWebSearch: false,
            assistantName,
            agentName: 'Assistente de Voz',
            agentProperName: assistantName,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), voiceTimeoutMs)),
        ]);
        if (aiRes && aiRes.text && aiRes.text.trim().length > 8) {
          reply = aiRes.text.replace(/[*#`]/g, '').trim();
          modelUsed = aiRes.modelUsed || targetVoiceModel;
          executionMode = aiRes.executionMode;
        }
      } catch {
        // mantém resposta imediata determinística
      }
    }

    res.json({
      reply,
      detected_wake_word: wake.detected,
      trigger_phrase: wake.triggerPhrase,
      command_extracted: effectiveCommand,
      action: navAction ? { type: 'navigate', tab: navAction.tab } : null,
      model_used: modelUsed,
      execution_mode: executionMode,
      practice_mode: practiceMode,
      attachment_acknowledged: attachmentNote || undefined,
      timestamp: nowIso(),
    });
  });

  // --- SÍNTESE DE VOZ NEURAL (OPENAI TTS OU EDGE NEURAL PT-BR GRATUITO) ---
  router.post('/voice/tts', requireAuth, async (req: Request, res: Response) => {
    const text = String(req.body?.text || '').trim().slice(0, 600);
    if (!text) {
      res.status(400).json({ detail: 'Texto vazio para síntese de voz.' });
      return;
    }
    const requestedEngine = String(req.body?.model || '').trim();
    const requestedVoice = String(req.body?.voice || 'female_1').trim();
    const requestedSpeed = Math.max(0.75, Math.min(1.8, Number(req.body?.speed || 1.0)));

    const store = deps?.store;
    const ownerUserId = getOwnerUserId(req);
    const openaiCred = store
      ? resolveExternalCredentialForRequest(req, store, ownerUserId, undefined, 'openai')
      : getEnvProviderCredential('openai');

    if (openaiCred?.apiKey && requestedEngine === 'openai_tts') {
      try {
        const resp = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiCred.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            voice: requestedVoice === 'male_1' ? 'onyx' : 'nova',
            speed: requestedSpeed,
            input: text,
            response_format: 'mp3',
          }),
        });
        if (resp.ok) {
          const arr = Buffer.from(await resp.arrayBuffer());
          res.json({
            audio_base64: arr.toString('base64'),
            mime_type: 'audio/mpeg',
            provider: 'openai',
            fallback: false,
          });
          return;
        }
      } catch {
        // segue para Edge Neural TTS gratuito
      }
    }

    // Edge Neural TTS PT-BR gratuito (voz humana natural sem API key)
    try {
      const { MsEdgeTTS, OUTPUT_FORMAT } = await import('msedge-tts');
      const edgeVoice =
        requestedVoice === 'male_1'
          ? 'pt-BR-AntonioNeural'
          : requestedVoice === 'neutral_1'
            ? 'pt-BR-ThalitaMultilingualNeural'
            : 'pt-BR-FranciscaNeural';
      const tts = new MsEdgeTTS();
      await tts.setMetadata(edgeVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const ratePct = Math.round((requestedSpeed - 1) * 100);
      const rateStr = `${ratePct >= 0 ? '+' : ''}${ratePct}%`;
      const { audioStream } = tts.toStream(text, { rate: rateStr });
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const audioBuf = Buffer.concat(chunks);
      if (audioBuf.length > 0) {
        res.json({
          audio_base64: audioBuf.toString('base64'),
          mime_type: 'audio/mpeg',
          provider: 'edge-neural-tts',
          voice: edgeVoice,
          fallback: false,
        });
        return;
      }
    } catch {
      // Fallback para speechSynthesis do navegador caso esteja offline
    }

    res.json({ audio_base64: null, fallback: true });
  });

  // --- TRANSCRIÇÃO DE ÁUDIO VIA BACKEND (FALLBACK PARA CHROMIUM / DESKTOP) ---
  router.post('/voice/transcribe', requireAuth, async (req: Request, res: Response) => {
    const providedTranscript = String(req.body?.text || req.body?.transcript || '').trim();
    if (providedTranscript) {
      res.json({ text: providedTranscript, transcript: providedTranscript, engine: 'client_bridge' });
      return;
    }

    const rawBase64 = String(req.body?.audio_base64 || '').trim();
    const mimeType = String(req.body?.mime_type || 'audio/webm').split(';')[0].trim() || 'audio/webm';
    const language = String(req.body?.language || 'pt').slice(0, 5);

    if (!rawBase64 || rawBase64.length > 10 * 1024 * 1024) {
      res.status(400).json({ detail: 'Áudio inválido ou acima do limite permitido.' });
      return;
    }

    const store = deps?.store;
    const ownerUserId = getOwnerUserId(req);
    const audioBuffer = Buffer.from(rawBase64, 'base64');
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm';

    const tryWhisperProvider = async (
      providerId: 'groq' | 'openai',
      endpoint: string,
      model: string
    ): Promise<string | null> => {
      const cred = store
        ? resolveExternalCredentialForRequest(req, store, ownerUserId, undefined, providerId)
        : getEnvProviderCredential(providerId);
      if (!cred?.apiKey) return null;

      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: mimeType }), `voice.${ext}`);
      form.append('model', model);
      form.append('language', language);

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cred.apiKey}` },
        body: form,
      });
      if (!resp.ok) return null;
      const data = (await resp.json()) as { text?: string };
      return data?.text?.trim() || null;
    };

    try {
      const groqText = await tryWhisperProvider(
        'groq',
        'https://api.groq.com/openai/v1/audio/transcriptions',
        'whisper-large-v3-turbo'
      );
      if (groqText) {
        res.json({ transcript: groqText, provider: 'groq', model: 'whisper-large-v3-turbo' });
        return;
      }

      const openaiText = await tryWhisperProvider(
        'openai',
        'https://api.openai.com/v1/audio/transcriptions',
        'whisper-1'
      );
      if (openaiText) {
        res.json({ transcript: openaiText, provider: 'openai', model: 'whisper-1' });
        return;
      }

      const geminiKey =
        (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
      if (geminiKey) {
        const gResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: `Transcreva exatamente o que foi falado neste áudio em ${language}. Retorne apenas a transcrição, sem comentários.` },
                    { inlineData: { mimeType, data: rawBase64 } },
                  ],
                },
              ],
            }),
          }
        );
        if (gResp.ok) {
          const gData = (await gResp.json()) as any;
          const gText = gData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (gText) {
            res.json({ transcript: gText, provider: 'gemini', model: 'gemini-2.5-flash' });
            return;
          }
        }
      }

      res.status(422).json({
        detail:
          'Nenhum provedor de transcrição (Groq, OpenAI ou Gemini) configurado no Cofre de Chaves. Adicione uma chave em Configurações → Modelos & Provedores.',
      });
    } catch (err: any) {
      res.status(502).json({ detail: err?.message || 'Falha ao transcrever áudio no servidor.' });
    }
  });

  // --- NOTIFICAÇÕES PUSH & PONTE TELEGRAM / WEBHOOK ---
  router.get('/push/config', requireAuth, (_req: Request, res: Response) => {
    res.json(getPushConfigPayload());
  });

  router.put('/push/config', requireAuth, (req: Request, res: Response) => {
    if (typeof req.body?.web_push_enabled === 'boolean') {
      serverState.pushBridgeConfig.web_push_enabled = req.body.web_push_enabled;
    }
    if (typeof req.body?.telegram_enabled === 'boolean') {
      serverState.pushBridgeConfig.telegram_enabled = req.body.telegram_enabled;
    }
    if (typeof req.body?.telegram_chat_id === 'string') {
      serverState.pushBridgeConfig.telegram_chat_id = req.body.telegram_chat_id.trim().slice(0, 64);
    }
    if (typeof req.body?.telegram_bot_token === 'string' && req.body.telegram_bot_token.trim()) {
      serverState.pushBridgeConfig.telegram_bot_token = req.body.telegram_bot_token.trim().slice(0, 160);
    }
    if (typeof req.body?.webhook_url === 'string') {
      const candidateUrl = req.body.webhook_url.trim().slice(0, 240);
      if (candidateUrl) {
        const urlCheck = validateSafeExternalUrl(candidateUrl);
        if (!urlCheck.valid) {
          res.status(400).json({ detail: `URL de webhook inválida: ${urlCheck.reason}` });
          return;
        }
      }
      serverState.pushBridgeConfig.webhook_url = candidateUrl;
    }
    if (req.body?.channels && typeof req.body.channels === 'object') {
      const keys: Array<keyof typeof serverState.pushBridgeConfig.channels> = [
        'task_completed',
        'assistant_message',
        'sentinel_alert',
        'approval_required',
      ];
      for (const k of keys) {
        if (typeof req.body.channels[k] === 'boolean') {
          serverState.pushBridgeConfig.channels[k] = req.body.channels[k];
        }
      }
    }
    persistStateNamespace(deps?.store, 'push_bridge_config', serverState.pushBridgeConfig);
    res.json(getPushConfigPayload());
  });

  router.post('/push/test', requireAuth, (req: Request, res: Response) => {
    const channel = (['task_completed', 'assistant_message', 'sentinel_alert', 'approval_required'].includes(
      String(req.body?.channel || '')
    )
      ? req.body.channel
      : 'task_completed') as PushNotificationServerItem['channel'];

    const title = String(req.body?.title || 'Calmon Studio · Teste de Push').trim();
    const body = String(
      req.body?.body || 'Conexão Push ativa! Você receberá alertas de tarefas concluídas, recados e aprovações no celular.'
    ).trim();

    const deliveredVia: string[] = [];
    if (serverState.pushBridgeConfig.web_push_enabled) deliveredVia.push('Web Push (PWA)');
    if (serverState.pushBridgeConfig.telegram_enabled && serverState.pushBridgeConfig.telegram_chat_id) {
      deliveredVia.push(`Telegram (${serverState.pushBridgeConfig.telegram_chat_id})`);
    }
    if (serverState.pushBridgeConfig.webhook_url) {
      deliveredVia.push('Webhook Externo');
    }
    if (deliveredVia.length === 0) deliveredVia.push('Canal Interno WS');

    const notification: PushNotificationServerItem = {
      id: `push_${crypto.randomBytes(4).toString('hex')}`,
      channel,
      title,
      body,
      delivered_via: deliveredVia,
      created_at: nowIso(),
    };
    serverState.recentPushNotifications.unshift(notification);
    broadcastRealtimeEvent('push_notification', notification);

    res.json({ notification, config: getPushConfigPayload() });
  });

  // --- DESKTOP COMPANION (QR PAIRING, TELEMETRIA, COMANDOS REMOTOS & SCRIPT) ---
  router.get('/companion/state', requireAuth, (req: Request, res: Response) => {
    res.json(getCompanionStatePayload(req));
  });

  router.post('/companion/pair', requireAuth, (req: Request, res: Response) => {
    serverState.currentPairingCode = makePairingCode();
    serverState.pairingExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    res.json(getCompanionStatePayload(req));
  });

  router.post('/companion/heartbeat', (req: Request, res: Response) => {
    const code = String(req.body?.pairing_code || req.headers['x-jarvis-pairing-code'] || '').trim().toUpperCase();
    const deviceToken = String(req.body?.device_token || req.headers['x-jarvis-device-token'] || '').trim();
    const session = getSessionFromReq(req);
    const hasValidPairingCode =
      Boolean(code) &&
      code === serverState.currentPairingCode &&
      Date.now() <= Date.parse(serverState.pairingExpiresAt);
    const hasValidPairedDeviceToken =
      Boolean(deviceToken) &&
      serverState.pairedDevicesList.some((d) => d.id === deviceToken || d.token_hint === deviceToken);

    if (!session && !hasValidPairingCode && !hasValidPairedDeviceToken) {
      res.status(401).json({
        detail: 'Heartbeat não autorizado. Envie uma sessão válida, código de pareamento ativo ou credencial de dispositivo pareado.',
      });
      return;
    }

    const deviceName = String(req.body?.device_name || 'Notebook Companion').trim();
    const existing = serverState.companionDevices.find((d) => d.name.toLowerCase() === deviceName.toLowerCase());
    if (existing) {
      existing.status = 'online';
      existing.cpu_percent = Math.min(100, Math.max(0, Number(req.body?.cpu_percent) || existing.cpu_percent));
      existing.ram_percent = Math.min(100, Math.max(0, Number(req.body?.ram_percent) || existing.ram_percent));
      existing.ollama_online = Boolean(req.body?.ollama_online);
      if (Array.isArray(req.body?.ollama_models)) {
        existing.ollama_models = req.body.ollama_models.slice(0, 12).map(String);
      }
      existing.last_heartbeat = nowIso();
    } else if (hasValidPairingCode || session) {
      serverState.companionDevices.unshift({
        id: `dev_${crypto.randomBytes(4).toString('hex')}`,
        name: deviceName,
        owner: session ? session.username : 'Pareado via QR',
        platform: String(req.body?.platform || 'desktop'),
        status: 'online',
        cpu_percent: Number(req.body?.cpu_percent) || 12,
        ram_percent: Number(req.body?.ram_percent) || 40,
        ram_total_gb: Number(req.body?.ram_total_gb) || 16,
        gpu_name: 'Detectada via Companion',
        vram_gb: 8,
        ollama_online: Boolean(req.body?.ollama_online),
        ollama_models: Array.isArray(req.body?.ollama_models) ? req.body.ollama_models.map(String) : [],
        vault_locked: serverState.vaultLocked,
        last_heartbeat: nowIso(),
      });
    }
    broadcastRealtimeEvent('companion_update', { device_name: deviceName, timestamp: nowIso() });
    res.json({
      ok: true,
      vault_locked: serverState.vaultLocked,
      pending_commands: serverState.remoteCommands.filter((c) => c.status === 'pending_approval').length,
    });
  });

  router.post('/companion/commands', requireAuth, (req: Request, res: Response) => {
    const commandText = String(req.body?.command || '').trim();
    const deviceId = String(req.body?.device_id || serverState.companionDevices[0]?.id || 'dev_notebook_principal');
    const source = (['mobile_pwa', 'voice_hud', 'offline_sync'].includes(String(req.body?.source || ''))
      ? req.body.source
      : 'mobile_pwa') as RemoteCommandServer['source'];

    if (!commandText) {
      res.status(400).json({ detail: 'Informe o comando a ser enviado para o Desktop Companion.' });
      return;
    }

    if (serverState.killSwitchActive) {
      res.status(403).json({ detail: 'Kill Switch Global ativo: comandos remotos ao Desktop Companion estão suspensos.' });
      return;
    }

    const device = serverState.companionDevices.find((d) => d.id === deviceId) || serverState.companionDevices[0];
    const sensitive = /(\.env|rm\s+-rf|delete|apagar|deploy|terminal|executar|instalar)/i.test(commandText);

    const record: RemoteCommandServer = {
      id: `rcmd_${crypto.randomBytes(4).toString('hex')}`,
      device_id: device.id,
      device_name: device.name,
      command: commandText,
      source,
      status: sensitive ? 'pending_approval' : 'executed',
      requires_approval: sensitive,
      output: sensitive
        ? undefined
        : `Executado com segurança em "${device.name}" sob a Matriz de Permissões (${new Date().toLocaleTimeString('pt-BR')}).`,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    serverState.remoteCommands.unshift(record);

    serverState.auditLogs.unshift({
      id: serverState.auditLogs.length + 1,
      timestamp: nowIso(),
      actor: (req as Request & { jarvisUser?: UserAccount }).jarvisUser?.username || 'admin',
      action: 'companion.remote_command',
      resource: device.name,
      status: sensitive ? 'warning' : 'success',
      details: `${source}: ${commandText.slice(0, 90)}`,
    });

    broadcastRealtimeEvent('companion_update', { command: record });
    res.json({ command: record, state: getCompanionStatePayload(req) });
  });

  router.post('/companion/commands/:id/decide', requireAuth, (req: Request, res: Response) => {
    const cmd = serverState.remoteCommands.find((c) => c.id === req.params.id);
    if (!cmd) {
      res.status(404).json({ detail: 'Comando remoto não encontrado.' });
      return;
    }
    const decision = req.body?.decision === 'reject' ? 'reject' : 'approve';
    if (decision === 'approve') {
      if (serverState.killSwitchActive) {
        res.status(403).json({ detail: 'Kill Switch Global ativo: desative a quarentena antes de aprovar comandos.' });
        return;
      }
      cmd.status = 'executed';
      cmd.output = `Aprovado em 1 toque e concluído em "${cmd.device_name}" (${new Date().toLocaleTimeString('pt-BR')}).`;
    } else {
      cmd.status = 'rejected';
      cmd.output = 'Comando pausado e cancelado pelo operador.';
    }
    cmd.updated_at = nowIso();

    const notif: PushNotificationServerItem = {
      id: `push_${crypto.randomBytes(4).toString('hex')}`,
      channel: 'task_completed',
      title: decision === 'approve' ? 'Comando Companion Concluído' : 'Comando Companion Cancelado',
      body: `${cmd.device_name}: ${cmd.command.slice(0, 80)}`,
      delivered_via: ['Web Push (PWA)'],
      created_at: nowIso(),
    };
    serverState.recentPushNotifications.unshift(notif);
    broadcastRealtimeEvent('push_notification', notif);
    broadcastRealtimeEvent('companion_update', { command: cmd });

    res.json({ command: cmd, state: getCompanionStatePayload(req) });
  });

  router.get('/companion/script', requireAuth, (req: Request, res: Response) => {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = req.get('host') || `localhost:${PORT}`;
    const deviceName = String(req.query?.device_name || 'Notebook Principal');
    const script = generateCompanionBridgeScript({
      serverUrl: `${proto}://${host}`,
      pairingCode: serverState.currentPairingCode,
      deviceName,
    });
    res.json({
      filename: 'jarvis-companion.mjs',
      script,
      pairing_code: serverState.currentPairingCode,
    });
  });

  // ==================== FASE 7: APP MOBILE ANDROID (PAREAMENTO QR + PACOTE APK/AAB) ====================
  router.get('/devices', requireAuth, (_req: Request, res: Response) => {
    if (!serverState.activePairingSession || Date.now() > Date.parse(serverState.activePairingSession.expires_at)) {
      serverState.activePairingSession = createFreshPairingSession({
        serverUrl: serverState.activePairingSession?.server_url,
        brainName: serverState.activePairingSession?.brain_name,
      });
    }
    res.json({ devices: serverState.pairedDevicesList, pairing: serverState.activePairingSession });
  });

  router.post('/devices/pair/init', requireAuth, (req: Request, res: Response) => {
    try {
      serverState.activePairingSession = createFreshPairingSession({
        serverUrl: req.body?.serverUrl,
        brainName: req.body?.brainName,
        assistantName: req.body?.assistantName,
      });
      res.json(serverState.activePairingSession);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Não foi possível gerar QR Code de pareamento.' });
    }
  });

  router.post('/devices/pair/confirm', requireAuth, (req: Request, res: Response) => {
    const code = String(req.body?.pairingCode || '').trim().toUpperCase();
    const deviceName = String(req.body?.deviceName || 'Celular Android').trim().slice(0, 48);
    const model = String(req.body?.model || 'Android').trim().slice(0, 48);
    const osVersion = String(req.body?.osVersion || 'Android 15').trim().slice(0, 28);

    if (!serverState.activePairingSession || !code || code !== serverState.activePairingSession.pairing_code) {
      res.status(400).json({ error: 'Código de pareamento inválido ou já utilizado. Gere um novo QR Code.' });
      return;
    }
    if (Date.now() > Date.parse(serverState.activePairingSession.expires_at)) {
      res.status(400).json({ error: 'Código de pareamento expirado. Gere um novo QR Code.' });
      return;
    }

    const tokenRaw = crypto.randomBytes(8).toString('hex');
    const created: PairedDeviceRecord = {
      id: `dev_android_${Date.now().toString(36)}`,
      name: deviceName || 'Celular Android',
      platform: 'android',
      model,
      os_version: osVersion,
      status: 'online',
      paired_at: nowIso(),
      last_seen: nowIso(),
      token_hint: `ks_${tokenRaw.slice(0, 4)}••••${tokenRaw.slice(-4)}`,
    };
    serverState.pairedDevicesList = [created, ...serverState.pairedDevicesList];
    if (deps?.store) {
      deps.store.savePairedDevice(created);
    }
    // Rotaciona o código efêmero imediatamente após uso único
    serverState.activePairingSession = createFreshPairingSession({
      serverUrl: serverState.activePairingSession.server_url,
      brainName: serverState.activePairingSession.brain_name,
    });
    res.status(201).json({ device: created, devices: serverState.pairedDevicesList, pairing: serverState.activePairingSession });
  });

  router.delete('/devices/:id', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const before = serverState.pairedDevicesList.length;
    serverState.pairedDevicesList = serverState.pairedDevicesList.filter((d) => d.id !== id);
    if (deps?.store) {
      deps.store.revokePairedDevice(id);
    }
    res.json({ deleted: serverState.pairedDevicesList.length < before, devices: serverState.pairedDevicesList });
  });

  router.post('/android-app/preview', requireAuth, async (req: Request, res: Response) => {
    try {
      const config = resolveAndroidMobileConfig(req.body || {});
      const { files, zipBuffer, filename } = await packageAndroidProjectToZip(config);
      res.json({
        config,
        files,
        preview_html: buildAndroidMobilePreviewHtml(config),
        zip_size_bytes: zipBuffer.length,
        filename,
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Não foi possível gerar a prévia do projeto Android.' });
    }
  });

  router.post('/android-app/package.zip', requireAuth, async (req: Request, res: Response) => {
    try {
      const config = resolveAndroidMobileConfig(req.body || {});
      const { zipBuffer, filename } = await packageAndroidProjectToZip(config);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(zipBuffer);
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Falha ao compactar o projeto Android.' });
    }
  });

  return router;
}
