import crypto from 'node:crypto';
import express, { Request, Response, Router } from 'express';
import {
  serverState,
  userProfiles,
  requireAuth,
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

export function createVoiceCompanionRouter(deps?: { store?: LocalSqliteBrainStore }): Router {
  const router = express.Router();

  // --- VOZ "EI [NOME]" & BRIEFING DIÁRIO ---
  router.get('/voice/briefing', requireAuth, (req: Request, res: Response) => {
    const user = (req as Request & { jarvisUser?: UserAccount }).jarvisUser;
    const profile = user ? userProfiles.get(user.username) : undefined;
    const assistantName = String(profile?.assistantName || 'JARVIS');
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
    const assistantName = String(profile?.assistantName || 'JARVIS');
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

    let reply = '';
    let modelUsed = 'voice-local-fast';
    let executionMode: 'LOCAL' | 'ONLINE' = 'LOCAL';

    if (practiceMode === 'english') {
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

    // Tenta enriquecer com motor híbrido rápido (timeout curto de 4.5s para voz fluida)
    if (serverState.providerConnectivity.gemini_connected || serverState.providerConnectivity.ollama_connected) {
      try {
        const activeHw = getActiveHardwareProfile();
        const voicePrompt =
          practiceMode === 'english'
            ? `You are ${assistantName}, a friendly English voice tutor. Reply in 2 short spoken sentences in English with a gentle tip and a follow-up question. User said: "${effectiveCommand}". ${attachmentNote}`
            : `Você é ${assistantName}, assistente pessoal por voz estilo JARVIS falando com ${userName}. Responda em português de forma calorosa, direta e natural para ser lida em voz alta (máximo 3 frases curtas). Contexto atual: ${pendingApp} aprovações pendentes, ${openInc} alertas Sentinela, Vault Lock ${serverState.vaultLocked ? 'travado' : 'aberto'}. ${attachmentNote} Pedido falado: "${effectiveCommand}"`;

        const aiRes = await Promise.race([
          runHybridInference({
            prompt: voicePrompt,
            systemInstruction: 'Responda em texto limpo sem markdown excessivo, pronto para síntese de voz.',
            requestedModel: 'gemini-3.1-flash-lite',
            routingPolicy: 'auto_hybrid',
            ollamaBaseUrl: activeHw.ollama_url,
            ollamaConnected: serverState.providerConnectivity.ollama_connected,
            geminiConnected: serverState.providerConnectivity.gemini_connected,
            enableWebSearch: false,
            assistantName,
            agentName: 'Assistente de Voz',
            agentProperName: assistantName,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4500)),
        ]);
        if (aiRes && aiRes.text && aiRes.text.trim().length > 8) {
          reply = aiRes.text.replace(/[*#`]/g, '').trim();
          modelUsed = aiRes.modelUsed || 'gemini-3.1-flash-lite';
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
      model_used: modelUsed,
      execution_mode: executionMode,
      practice_mode: practiceMode,
      attachment_acknowledged: attachmentNote || undefined,
      timestamp: nowIso(),
    });
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
      serverState.pushBridgeConfig.webhook_url = req.body.webhook_url.trim().slice(0, 240);
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
    res.json(getPushConfigPayload());
  });

  router.post('/push/test', requireAuth, (req: Request, res: Response) => {
    const channel = (['task_completed', 'assistant_message', 'sentinel_alert', 'approval_required'].includes(
      String(req.body?.channel || '')
    )
      ? req.body.channel
      : 'task_completed') as PushNotificationServerItem['channel'];

    const title = String(req.body?.title || 'JARVIS AI Hub · Teste de Push').trim();
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
    const code = String(req.body?.pairing_code || '').trim().toUpperCase();
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
    } else if (code === serverState.currentPairingCode) {
      serverState.companionDevices.unshift({
        id: `dev_${crypto.randomBytes(4).toString('hex')}`,
        name: deviceName,
        owner: 'Pareado via QR',
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
