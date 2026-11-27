import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Terminal,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { sendVoiceTurn, synthesizeVoiceAudio, transcribeVoiceAudio } from '../../services/api';
import { getAccountStorageKey } from '../../services/accountScope';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';
import { useOfflineQueue } from '../../shared/network/useOfflineQueue';
import { notify } from '../../shared/common/Toast';
import {
  getVoiceAutoSpeakPref,
  setVoiceAutoSpeakPref,
} from '../../hooks/useWakeWordListener';

interface VoiceLiveHudModalProps {
  isOpen: boolean;
  onClose: () => void;
  autoListenOnOpen?: boolean;
  initialCommand?: string | null;
  onInitialCommandConsumed?: () => void;
  wakeWordEnabled?: boolean;
  onToggleWakeWord?: () => void;
  onOpenChat?: (prompt?: string) => void;
  onNavigate?: (tab: string) => void;
}

interface VoiceTurnItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
}

function playJarvisChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(523.25, now); // C5
    osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.14); // G5
    gain1.gain.setValueAtTime(0.001, now);
    gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.03);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.3);
  } catch {
    // Web Audio bloqueado antes de gesto do usuário
  }
}

function pickNaturalBrowserVoice(lang: 'pt-BR' | 'en-US'): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const prefix = lang.toLowerCase().split('-')[0];
    const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
    const pool = matching.length > 0 ? matching : voices;
    const preferred = pool.find((v) =>
      /google|microsoft|natural|neural|luciana|francisca|maria|fernanda/i.test(v.name)
    );
    const nonRobotic = pool.find((v) => !/espeak|mbrola/i.test(v.name));
    return preferred || nonRobotic || pool[0] || null;
  } catch {
    return null;
  }
}

function readVoiceSettings(): {
  voice: string;
  speed: number;
  model: string;
  vadPauseMs: number;
} {
  try {
    const raw = localStorage.getItem(getAccountStorageKey('jarvis_openbot_general_settings'));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        voice: typeof parsed.selectedVoice === 'string' ? parsed.selectedVoice : 'female_1',
        speed: typeof parsed.speechSpeed === 'number' ? parsed.speechSpeed : 1.0,
        model: typeof parsed.ttsModel === 'string' ? parsed.ttsModel : 'edge_neural',
        vadPauseMs: Math.max(700, Math.min(4000, Math.round((Number(parsed.vadPauseSeconds) || 1.5) * 1000))),
      };
    }
  } catch {
    // defaults
  }
  return { voice: 'female_1', speed: 1.0, model: 'edge_neural', vadPauseMs: 1500 };
}

async function speakText(text: string, lang: 'pt-BR' | 'en-US'): Promise<void> {
  const prefs = readVoiceSettings();
  if (prefs.model !== 'webspeech') {
    try {
      const neural = await synthesizeVoiceAudio(text, {
        voice: prefs.voice,
        speed: prefs.speed,
        model: prefs.model,
      }).catch(() => null);
      if (neural && !neural.fallback && neural.audio_base64) {
        const audio = new Audio(`data:${neural.mime_type || 'audio/mpeg'};base64,${neural.audio_base64}`);
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
        return;
      }
    } catch {
      // segue para Web Speech fallback
    }
  }

  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang;
      utter.rate = prefs.speed;
      utter.pitch = 1.0;
      const voice = pickNaturalBrowserVoice(lang);
      if (voice) utter.voice = voice;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  } catch {
    // ignore speech synthesis fallback
  }
}

export const VoiceLiveHudModal: React.FC<VoiceLiveHudModalProps> = ({
  isOpen,
  onClose,
  autoListenOnOpen = true,
  initialCommand = null,
  onInitialCommandConsumed,
  wakeWordEnabled = false,
  onToggleWakeWord,
  onOpenChat,
  onNavigate,
}) => {
  const { assistantName } = useAssistantIdentity();
  const { isOnline, addCommand } = useOfflineQueue();

  const [listening, setListening] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [speechOutEnabled, setSpeechOutEnabled] = useState<boolean>(() => getVoiceAutoSpeakPref());
  const [inputText, setInputText] = useState('');
  const [turns, setTurns] = useState<VoiceTurnItem[]>([]);
  const [voiceLogs, setVoiceLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<number | null>(null);
  const vadAudioCtxRef = useRef<AudioContext | null>(null);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  const cleanupVad = () => {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (vadAudioCtxRef.current && vadAudioCtxRef.current.state !== 'closed') {
      try {
        void vadAudioCtxRef.current.close();
      } catch {
        // ignore
      }
      vadAudioCtxRef.current = null;
    }
  };

  const appendVoiceLog = (entry: string) => {
    const ts = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const line = `[${ts}] ${entry}`;
    console.info('[VoiceDiag]', line);
    setVoiceLogs((prev) => [...prev.slice(-24), line]);
  };

  useEffect(() => {
    const syncVoicePref = () => setSpeechOutEnabled(getVoiceAutoSpeakPref());
    window.addEventListener('jarvis_voice_prefs_changed', syncVoicePref);
    return () => window.removeEventListener('jarvis_voice_prefs_changed', syncVoicePref);
  }, []);

  const stopMicrophone = () => {
    cleanupVad();
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    } else {
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
    }
    setListening(false);
  };

  const handleSendCommand = async (rawTranscript?: string) => {
    const text = (rawTranscript ?? inputText).trim();
    if (!text || processing) return;

    const nowTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    setTurns((prev) => [
      ...prev,
      {
        id: `u_${Date.now()}`,
        role: 'user',
        text,
        timestamp: nowTime,
      },
    ]);
    setInputText('');

    if (!isOnline) {
      addCommand(text, 'voice');
      setTurns((prev) => [
        ...prev,
        {
          id: `off_${Date.now()}`,
          role: 'assistant',
          text: `Sem conexão: "${text}" salvo na Fila Offline e será sincronizado ao reconectar.`,
          timestamp: nowTime,
        },
      ]);
      notify('Comando salvo na Fila Offline do PWA.', 'warning');
      return;
    }

    setProcessing(true);
    try {
      const res = await sendVoiceTurn({
        transcript: text,
        practice_mode: 'general',
      });
      if (res.detected_wake_word) playJarvisChime();
      setTurns((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      if (speechOutEnabled) {
        await speakText(res.reply, 'pt-BR');
      }
      if (res.action?.type === 'navigate' && res.action.tab) {
        if (res.action.tab === 'chat' && onOpenChat) {
          onOpenChat();
        } else if (onNavigate) {
          onNavigate(res.action.tab);
        }
      } else if (isOpenRef.current && autoListenOnOpen) {
        // Ciclo contínuo mãos-livres: volta a escutar automaticamente após responder
        startMicrophone(true);
      }
    } catch (err: any) {
      notify(err?.message || 'Erro no processamento de voz.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const probeMicrophoneHardware = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        appendVoiceLog('navigator.mediaDevices.getUserMedia indisponível (contexto não seguro?)');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tracks = stream.getAudioTracks();
      const label = tracks[0]?.label || 'Microfone padrão';
      appendVoiceLog(`Hardware OK: "${label}" (${tracks.length} faixa(s) de áudio)`);
      tracks.forEach((t) => t.stop());
    } catch (err: any) {
      appendVoiceLog(`Falha getUserMedia: ${err?.name || 'Error'} — ${err?.message || err}`);
    }
  };

  const startMediaRecorderFallback = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      appendVoiceLog('MediaRecorder indisponível neste navegador.');
      setMicHint('Gravação de áudio indisponível — digite abaixo.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        mediaRecorderRef.current = null;
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        recordedChunksRef.current = [];
        if (blob.size < 400) {
          appendVoiceLog('Áudio muito curto ignorado.');
          return;
        }
        appendVoiceLog(`Áudio gravado (${(blob.size / 1024).toFixed(1)} KB) → enviando para /voice/transcribe...`);
        setProcessing(true);
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const raw = String(reader.result || '');
              resolve(raw.includes(',') ? raw.split(',')[1] : raw);
            };
            reader.onerror = () => reject(new Error('Falha ao ler áudio'));
            reader.readAsDataURL(blob);
          });
          const res = await transcribeVoiceAudio({
            audio_base64: base64,
            mime_type: mimeType,
            language: 'pt',
          });
          appendVoiceLog(`Transcrito (${res.provider}/${res.model}): "${res.transcript}"`);
          setProcessing(false);
          void handleSendCommand(res.transcript);
        } catch (err: any) {
          setProcessing(false);
          const msg = err?.message || 'Falha na transcrição pelo servidor.';
          appendVoiceLog(`Erro /voice/transcribe: ${msg}`);
          setMicHint(msg);
          setShowLogs(true);
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setListening(true);
      setMicHint('Mãos-livres ativo — fale naturalmente, envio automático após pausa.');
      appendVoiceLog(`MediaRecorder + VAD iniciado (${mimeType})`);

      // Detecção automática de voz/silêncio (VAD) para envio mãos-livres
      try {
        cleanupVad();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          vadAudioCtxRef.current = ctx;
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          src.connect(analyser);
          const data = new Uint8Array(analyser.fftSize);
          const { vadPauseMs } = readVoiceSettings();
          let speechDetected = false;
          let lastSpeechAt = Date.now();
          const startedAt = Date.now();

          vadTimerRef.current = window.setInterval(() => {
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') {
              cleanupVad();
              return;
            }
            analyser.getByteTimeDomainData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) {
              const v = (data[i] - 128) / 128;
              sum += v * v;
            }
            const rms = Math.sqrt(sum / data.length);
            const now = Date.now();
            if (rms > 0.018) {
              speechDetected = true;
              lastSpeechAt = now;
            } else if (speechDetected && now - lastSpeechAt >= vadPauseMs) {
              cleanupVad();
              setListening(false);
              try {
                mediaRecorderRef.current?.stop();
              } catch {
                // ignore
              }
            } else if (!speechDetected && now - startedAt > 12_000) {
              // Evita gravação infinita se usuário não falar
              cleanupVad();
              setListening(false);
              try {
                mediaRecorderRef.current?.stop();
              } catch {
                // ignore
              }
            }
          }, 120);
        }
      } catch {
        // segue com controle manual se AudioContext falhar
      }
    } catch (err: any) {
      setListening(false);
      appendVoiceLog(`Falha MediaRecorder: ${err?.name || 'Error'} — ${err?.message || err}`);
      setMicHint('Permita o microfone no navegador ou digite abaixo.');
    }
  };

  const startMicrophone = (silentIfUnsupported = false) => {
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    appendVoiceLog(
      `Browser: ${navigator.userAgent.includes('Chromium') ? 'Chromium' : navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Outro'} | SpeechRecognition=${Boolean(SpeechRecognitionCtor)}`
    );

    if (!SpeechRecognitionCtor) {
      appendVoiceLog('SpeechRecognition indisponível; ativando MediaRecorder (servidor).');
      if (!silentIfUnsupported) void startMediaRecorderFallback();
      return;
    }

    try {
      stopMicrophone();
      setMicHint(null);
      const rec = new SpeechRecognitionCtor();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onstart = () => appendVoiceLog('onstart: reconhecimento iniciado (pt-BR)');
      rec.onaudiostart = () => appendVoiceLog('onaudiostart: captura de áudio iniciada');
      rec.onsoundstart = () => appendVoiceLog('onsoundstart: som detectado');
      rec.onspeechstart = () => appendVoiceLog('onspeechstart: fala detectada');
      rec.onresult = (event: any) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const chunk = event.results[i]?.[0]?.transcript || '';
          if (event.results[i]?.isFinal) finalText += chunk;
          else interim += chunk;
        }
        if (interim.trim()) {
          setInputText(interim.trim());
          appendVoiceLog(`onresult (parcial): "${interim.trim()}"`);
        }
        if (finalText.trim()) {
          appendVoiceLog(`onresult (final): "${finalText.trim()}"`);
          setListening(false);
          setInputText('');
          void handleSendCommand(finalText.trim());
        }
      };
      rec.onerror = (ev: any) => {
        const code = ev?.error || 'unknown';
        const detail = ev?.message ? ` (${ev.message})` : '';
        appendVoiceLog(`onerror: ${code}${detail}`);
        setListening(false);
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          setMicHint('Permita o microfone no navegador ou digite abaixo.');
        } else if (code === 'network') {
          appendVoiceLog('SpeechRecognition falhou com "network" → alternando para MediaRecorder (servidor)...');
          void startMediaRecorderFallback();
        } else if (code === 'audio-capture') {
          setMicHint('Sem captura de áudio (verifique o microfone no sistema).');
          setShowLogs(true);
          void probeMicrophoneHardware();
        } else if (!silentIfUnsupported) {
          setMicHint(`Erro de voz (${code}) — toque para tentar de novo.`);
        }
      };
      rec.onend = () => {
        appendVoiceLog('onend: reconhecimento finalizado');
        setListening(false);
      };
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch (err: any) {
      setListening(false);
      appendVoiceLog(`Exceção rec.start(): ${err?.message || err}`);
      setMicHint('Toque para liberar o microfone ou digite abaixo.');
    }
  };

  const toggleMicrophone = () => {
    if (listening) {
      stopMicrophone();
      return;
    }
    playJarvisChime();
    startMicrophone(false);
  };

  useEffect(() => {
    if (!isOpen) {
      stopMicrophone();
      return;
    }
    playJarvisChime();
    setMicHint(null);

    let timer: number | null = null;
    if (initialCommand && initialCommand.trim()) {
      const cmd = initialCommand.trim();
      onInitialCommandConsumed?.();
      void handleSendCommand(cmd);
    } else if (autoListenOnOpen) {
      timer = window.setTimeout(() => {
        startMicrophone(true);
      }, 180);
    }

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      stopMicrophone();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hudStatus = !isOnline
    ? 'Modo Offline · Fila PWA'
    : processing
      ? `${assistantName} processando...`
      : listening
        ? `Ouvindo... pode falar com ${assistantName}`
        : micHint
          ? micHint
          : `Pronto · Diga "Ei ${assistantName}"`;

  const latestTurn = turns[turns.length - 1];
  const lastUserPrompt = [...turns].reverse().find((t) => t.role === 'user')?.text;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Assistente de voz ${assistantName}`}
      className="jarvis-siri-pill"
      style={s.siriPill}
    >
      <div style={s.siriTopRow}>
        <button
          type="button"
          onClick={toggleMicrophone}
          aria-label={listening ? 'Parar escuta do microfone' : `Ativar microfone ${assistantName}`}
          title={listening ? 'Parar escuta' : 'Toque para falar'}
          style={{
            ...s.siriOrb,
            background: listening
              ? 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
              : 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)',
            boxShadow: listening
              ? '0 0 0 5px rgba(34, 197, 94, 0.22), 0 0 18px rgba(34, 197, 94, 0.45)'
              : processing
                ? '0 0 0 5px rgba(249, 115, 22, 0.22), 0 0 18px rgba(249, 115, 22, 0.4)'
                : '0 4px 14px rgba(249, 115, 22, 0.35)',
          }}
        >
          {listening ? <MicOff size={16} color="#ffffff" /> : <Mic size={16} color="#ffffff" />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.82rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>{assistantName} Voz</span>
            {listening && (
              <span style={{ fontSize: '0.7rem', color: '#4ade80', fontWeight: 500 }}>• Ao vivo</span>
            )}
          </div>
          <div
            style={{
              fontSize: '0.72rem',
              color: listening ? '#4ade80' : 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={hudStatus}
          >
            {hudStatus}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {onToggleWakeWord && (
            <button
              type="button"
              onClick={onToggleWakeWord}
              aria-pressed={wakeWordEnabled}
              className={`btn btn-icon-sm ${wakeWordEnabled ? 'btn-primary' : 'btn-ghost'}`}
              title={
                wakeWordEnabled
                  ? `Mãos-livres ativo ("Ei ${assistantName}")`
                  : `Ativar mãos-livres ("Ei ${assistantName}")`
              }
              aria-label="Alternar escuta mãos-livres"
            >
              <Sparkles size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const next = !speechOutEnabled;
              setSpeechOutEnabled(next);
              setVoiceAutoSpeakPref(next);
            }}
            className="btn btn-ghost btn-icon-sm"
            title={speechOutEnabled ? 'Silenciar resposta falada' : 'Ativar resposta falada'}
            aria-label="Alternar áudio de resposta"
          >
            {speechOutEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          {onOpenChat && (
            <button
              type="button"
              onClick={() => onOpenChat(lastUserPrompt)}
              className="btn btn-ghost btn-icon-sm"
              title="Continuar no Chat (histórico, câmera e PDF)"
              aria-label="Abrir conversa no Chat"
            >
              <MessageSquare size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('jarvis:open-voice-calibration'))}
            className="btn btn-ghost btn-xs"
            title="Calibrar sua voz gravando 3 vezes (Setup de Wake Word)"
            aria-label="Calibrar reconhecimento de voz"
            style={{ fontSize: '0.68rem', padding: '3px 7px' }}
          >
            Calibrar
          </button>
          <button
            type="button"
            onClick={() => setShowLogs((prev) => !prev)}
            className={`btn btn-icon-sm ${showLogs ? 'btn-secondary is-active' : 'btn-ghost'}`}
            title="Ver log de diagnóstico da voz"
            aria-label="Ver log de diagnóstico da voz"
            aria-pressed={showLogs}
          >
            <Terminal size={13} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon-sm"
            title="Fechar (Esc)"
            aria-label="Fechar assistente de voz"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {showLogs && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: '12px',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            color: 'var(--text-secondary)',
            maxHeight: '130px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <span style={{ color: 'var(--accent-light)', fontWeight: 600 }}>Log de Voz (Chromium/Browser)</span>
            <button
              type="button"
              onClick={() => void probeMicrophoneHardware()}
              className="btn btn-ghost btn-xs"
              style={{ padding: '2px 6px', fontSize: '0.66rem' }}
            >
              Testar Mic
            </button>
          </div>
          {voiceLogs.length === 0 ? (
            <span style={{ color: 'var(--text-muted)' }}>Nenhum evento registrado ainda.</span>
          ) : (
            voiceLogs.map((line, i) => (
              <div key={`${i}-${line.slice(0, 12)}`} style={{ wordBreak: 'break-word' }}>
                {line}
              </div>
            ))
          )}
        </div>
      )}

      {latestTurn && (
        <div style={s.siriReplyBox}>
          <div style={{ fontSize: '0.68rem', color: 'var(--accent-light)', fontWeight: 600, marginBottom: '2px' }}>
            {latestTurn.role === 'user' ? 'Você' : assistantName}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.45 }}>
            {latestTurn.text}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSendCommand();
            }
          }}
          placeholder={!isOnline ? 'Offline: enfileirar comando...' : `Fale ou digite para ${assistantName}...`}
          aria-label="Comando rápido de voz ou texto"
          style={s.siriInput}
        />
        <button
          type="button"
          onClick={() => void handleSendCommand()}
          disabled={processing || !inputText.trim()}
          className="btn btn-primary btn-icon-sm"
          title="Enviar comando"
          aria-label="Enviar comando"
          style={{ width: '32px', height: '32px', borderRadius: '999px', flexShrink: 0 }}
        >
          {!isOnline ? <WifiOff size={13} /> : <Send size={13} />}
        </button>
      </div>
    </div>
  );
};

const s: Record<string, React.CSSProperties> = {
  siriPill: {
    position: 'fixed',
    top: '76px',
    right: '20px',
    zIndex: 850,
    width: 'min(420px, calc(100vw - 24px))',
    padding: '12px 14px',
    borderRadius: '22px',
    background: 'var(--topbar-glass-bg, rgba(18, 22, 32, 0.86))',
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: '1px solid var(--sidebar-glass-border, rgba(255, 255, 255, 0.12))',
    boxShadow: 'var(--dock-glass-shadow, 0 20px 48px -10px rgba(0, 0, 0, 0.55))',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  siriTopRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    minWidth: 0,
  },
  siriOrb: {
    width: '36px',
    height: '36px',
    borderRadius: '999px',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'box-shadow 180ms ease, transform 180ms ease',
  },
  siriReplyBox: {
    padding: '8px 11px',
    borderRadius: '14px',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    maxHeight: '120px',
    overflowY: 'auto',
  },
  siriInput: {
    flex: 1,
    minWidth: 0,
    height: '32px',
    padding: '0 12px',
    borderRadius: '999px',
    backgroundColor: 'var(--bg-input)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontSize: '0.78rem',
    outline: 'none',
  },
};
