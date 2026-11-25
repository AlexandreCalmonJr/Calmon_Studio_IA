import React, { useEffect, useRef, useState } from 'react';
import {
  MessageSquare,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import { sendVoiceTurn } from '../../services/api';
import { useAssistantIdentity } from '../../context/AssistantIdentityContext';
import { useOfflineQueue } from '../../shared/pwa/usePWAInstall';
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

function speakText(text: string, lang: 'pt-BR' | 'en-US') {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 1.03;
    window.speechSynthesis.speak(utter);
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
}) => {
  const { assistantName } = useAssistantIdentity();
  const { isOnline, addCommand } = useOfflineQueue();

  const [listening, setListening] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [speechOutEnabled, setSpeechOutEnabled] = useState<boolean>(() => getVoiceAutoSpeakPref());
  const [inputText, setInputText] = useState('');
  const [turns, setTurns] = useState<VoiceTurnItem[]>([]);

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const syncVoicePref = () => setSpeechOutEnabled(getVoiceAutoSpeakPref());
    window.addEventListener('jarvis_voice_prefs_changed', syncVoicePref);
    return () => window.removeEventListener('jarvis_voice_prefs_changed', syncVoicePref);
  }, []);

  const stopMicrophone = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
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
        speakText(res.reply, 'pt-BR');
      }
    } catch (err: any) {
      notify(err?.message || 'Erro no processamento de voz.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const startMicrophone = (silentIfUnsupported = false) => {
    const SpeechRecognitionCtor =
      (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      const msg = 'Microfone indisponível neste navegador — digite abaixo.';
      setMicHint(msg);
      if (!silentIfUnsupported) notify(msg, 'info');
      return;
    }

    try {
      stopMicrophone();
      setMicHint(null);
      const rec = new SpeechRecognitionCtor();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.onresult = (event: any) => {
        let interim = '';
        let finalText = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const chunk = event.results[i]?.[0]?.transcript || '';
          if (event.results[i]?.isFinal) finalText += chunk;
          else interim += chunk;
        }
        if (interim.trim()) setInputText(interim.trim());
        if (finalText.trim()) {
          setListening(false);
          setInputText('');
          void handleSendCommand(finalText.trim());
        }
      };
      rec.onerror = (ev: any) => {
        setListening(false);
        if (ev?.error === 'not-allowed' || ev?.error === 'service-not-allowed') {
          setMicHint('Permita o microfone no navegador ou digite abaixo.');
        } else if (!silentIfUnsupported) {
          setMicHint('Não captei áudio — toque no botão para tentar de novo.');
        }
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
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
            onClick={onClose}
            className="btn btn-ghost btn-icon-sm"
            title="Fechar (Esc)"
            aria-label="Fechar assistente de voz"
          >
            <X size={14} />
          </button>
        </div>
      </div>

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
