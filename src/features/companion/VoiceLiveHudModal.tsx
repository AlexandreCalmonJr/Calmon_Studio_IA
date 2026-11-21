import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  FileText,
  Globe,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  WifiOff,
  X,
} from 'lucide-react';
import {
  VoiceBriefingResponse,
  fetchVoiceBriefing,
  sendVoiceTurn,
} from '../../services/api';
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
}

interface VoiceTurnItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
  timestamp: string;
}

function playJarvisChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
}) => {
  const { assistantName } = useAssistantIdentity();
  const { isOnline, addCommand } = useOfflineQueue();

  const [briefing, setBriefing] = useState<VoiceBriefingResponse | null>(null);
  const [listening, setListening] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [speechOutEnabled, setSpeechOutEnabled] = useState<boolean>(() => getVoiceAutoSpeakPref());
  const [practiceMode, setPracticeMode] = useState<'general' | 'english'>('general');
  const [inputText, setInputText] = useState('');
  const [attachment, setAttachment] = useState<{ name: string; kind: 'camera_photo' | 'pdf' } | null>(null);
  const [turns, setTurns] = useState<VoiceTurnItem[]>([]);

  const recognitionRef = useRef<any>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const syncVoicePref = () => setSpeechOutEnabled(getVoiceAutoSpeakPref());
    window.addEventListener('jarvis_voice_prefs_changed', syncVoicePref);
    return () => window.removeEventListener('jarvis_voice_prefs_changed', syncVoicePref);
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns.length]);

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
        text: attachment ? `${text} [${attachment.kind === 'pdf' ? 'PDF' : 'Câmera'}: ${attachment.name}]` : text,
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
          text: `Você está sem conexão no momento. Salvei "${text}" na Fila Offline e vou sincronizar automaticamente assim que a internet voltar.`,
          meta: 'Fila Offline · PWA',
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
        practice_mode: practiceMode,
        attachment_name: attachment?.name,
        attachment_kind: attachment?.kind,
      });
      setAttachment(null);
      if (res.detected_wake_word) playJarvisChime();
      const metaParts = [
        res.detected_wake_word ? `Ativação: ${res.trigger_phrase}` : 'Comando direto',
        `${res.execution_mode} · ${res.model_used}`,
      ];
      setTurns((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: res.reply,
          meta: metaParts.join(' · '),
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      if (speechOutEnabled) {
        speakText(res.reply, practiceMode === 'english' ? 'en-US' : 'pt-BR');
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
      const msg = 'Microfone indisponível neste navegador — digite seu pedido abaixo ou use um atalho.';
      setMicHint(msg);
      if (!silentIfUnsupported) notify(msg, 'info');
      return;
    }

    try {
      stopMicrophone();
      setMicHint(null);
      const rec = new SpeechRecognitionCtor();
      rec.lang = practiceMode === 'english' ? 'en-US' : 'pt-BR';
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
          setMicHint('Permita o acesso ao microfone no navegador para falar diretamente.');
        } else if (!silentIfUnsupported) {
          setMicHint('Não captei áudio agora — toque no anel laranja para tentar de novo ou digite abaixo.');
        }
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      setMicHint('Toque no anel laranja para liberar o microfone ou digite seu comando abaixo.');
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

    (async () => {
      try {
        const data = await fetchVoiceBriefing();
        setBriefing(data);
        setTurns((prev) =>
          prev.length > 0
            ? prev
            : [
                {
                  id: 'brief_0',
                  role: 'assistant',
                  text: `${data.greeting} ${data.briefing_line}`,
                  meta: `Briefing Diário · ${data.assistant_name}`,
                  timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
                },
              ]
        );
      } catch {
        // modo offline fallback
      }
    })();

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

  if (!isOpen) return null;

  const hudStatus = !isOnline
    ? 'Modo Offline · Gravando na Fila'
    : processing
      ? `${assistantName} processando...`
      : listening
        ? `Ouvindo agora... pode falar com ${assistantName}`
        : micHint
          ? micHint
          : `Pronto · Diga "Ei ${assistantName}"`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Modo Voz ao Vivo ${assistantName}`}
      style={s.backdrop}
    >
      <div style={s.modal}>
        {/* Header */}
        <div style={s.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                ...s.badgeDot,
                backgroundColor: listening ? '#22c55e' : '#f97316',
                boxShadow: listening ? '0 0 12px #22c55e' : '0 0 12px #f97316',
              }}
            />
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                Voz ao Vivo · &ldquo;Ei {assistantName}&rdquo;
              </h2>
              <div style={{ fontSize: '0.75rem', color: listening ? '#4ade80' : 'var(--text-secondary)' }}>
                {hudStatus}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {onToggleWakeWord && (
              <button
                type="button"
                onClick={onToggleWakeWord}
                aria-pressed={wakeWordEnabled}
                className={`btn btn-sm ${wakeWordEnabled ? 'btn-primary' : 'btn-secondary'}`}
                title={`Quando ativo, basta dizer "Ei ${assistantName}" sem clicar em nada`}
              >
                <Mic size={13} />
                <span>{wakeWordEnabled ? `Ouvindo "Ei ${assistantName}"` : 'Ativar mãos-livres'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setPracticeMode((m) => (m === 'general' ? 'english' : 'general'))}
              className={`btn btn-sm ${practiceMode === 'english' ? 'btn-primary' : 'btn-secondary'}`}
              title="Alternar modo de conversação prática em inglês"
            >
              <Globe size={13} />
              {practiceMode === 'english' ? 'Inglês: ON' : 'Praticar Inglês'}
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !speechOutEnabled;
                setSpeechOutEnabled(next);
                setVoiceAutoSpeakPref(next);
              }}
              className="btn btn-secondary btn-icon-sm"
              title={speechOutEnabled ? 'Silenciar resposta falada' : 'Ativar resposta falada'}
              aria-label="Alternar áudio de resposta"
            >
              {speechOutEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-icon-sm" aria-label="Fechar HUD de voz">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* HUD Laranja Animado */}
        <div style={s.hudStage}>
          <button
            type="button"
            onClick={toggleMicrophone}
            aria-label={listening ? 'Parar escuta do microfone' : `Ativar microfone Ei ${assistantName}`}
            style={{
              ...s.arcRingOuter,
              boxShadow: listening
                ? '0 0 0 12px rgba(249, 115, 22, 0.14), 0 0 38px rgba(249, 115, 22, 0.45)'
                : processing
                  ? '0 0 0 8px rgba(251, 146, 60, 0.16), 0 0 28px rgba(249, 115, 22, 0.35)'
                  : '0 0 24px rgba(249, 115, 22, 0.22)',
            }}
          >
            <div style={s.arcRingInner}>
              {listening ? <MicOff size={26} color="#fff7ed" /> : <Mic size={26} color="#fff7ed" />}
            </div>
          </button>

          <div style={{ textAlign: 'center', maxWidth: '520px' }}>
            <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              {briefing?.greeting || `Olá! Aqui é ${assistantName}. Como está seu dia?`}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {briefing?.briefing_line || 'Toque no anel laranja para falar ou escolha um comando rápido abaixo.'}
            </div>
          </div>

          {/* Comandos rápidos de ativação */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
            {(briefing?.quick_prompts || [
              `Ei ${assistantName}, qual é o meu briefing de hoje?`,
              `Ei ${assistantName}, chama a Kira para verificar alertas`,
            ]).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void handleSendCommand(q)}
                disabled={processing}
                style={s.quickChip}
              >
                <Sparkles size={11} color="var(--accent-color)" />
                <span>{q}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Histórico da Sessão de Voz */}
        <div style={s.transcriptBox}>
          {turns.map((turn) => (
            <div
              key={turn.id}
              style={{
                alignSelf: turn.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '86%',
                padding: '10px 13px',
                borderRadius: '11px',
                backgroundColor: turn.role === 'user' ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                border: `1px solid ${turn.role === 'user' ? 'var(--border-hover)' : 'var(--border-accent)'}`,
              }}
            >
              <div style={{ fontSize: '0.68rem', fontFamily: 'var(--font-mono)', color: turn.role === 'user' ? 'var(--text-muted)' : 'var(--accent-light)', marginBottom: '4px' }}>
                {turn.timestamp} · {turn.role === 'user' ? 'Você' : turn.meta || assistantName}
              </div>
              <div style={{ fontSize: '0.83rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {turn.text}
              </div>
            </div>
          ))}
          <div ref={transcriptEndRef} />
        </div>

        {/* Barra de envio multimodal (Câmera / PDF / Texto) */}
        <div style={s.composer}>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setAttachment({ name: file.name, kind: 'camera_photo' });
            }}
          />
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setAttachment({ name: file.name, kind: 'pdf' });
            }}
          />

          {attachment && (
            <div style={s.attachmentPill}>
              <span>{attachment.kind === 'pdf' ? 'PDF' : 'Foto'}: {attachment.name}</span>
              <button type="button" onClick={() => setAttachment(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
                <X size={12} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="btn btn-secondary btn-icon"
              title="Enviar foto da câmera (exercícios, documentos)"
              aria-label="Anexar foto da câmera"
            >
              <Camera size={16} />
            </button>
            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              className="btn btn-secondary btn-icon"
              title="Anexar arquivo PDF para análise por voz"
              aria-label="Anexar PDF"
            >
              <FileText size={16} />
            </button>
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
              placeholder={
                !isOnline
                  ? 'Offline: digite para enfileirar comando automático...'
                  : `Digite ou fale: "Ei ${assistantName}, ..."`
              }
              aria-label="Comando de voz ou texto"
              style={s.input}
            />
            <button
              type="button"
              onClick={() => void handleSendCommand()}
              disabled={processing || !inputText.trim()}
              className="btn btn-primary btn-sm"
              style={{ height: '38px', padding: '0 14px' }}
            >
              {!isOnline ? <WifiOff size={14} /> : <Send size={14} />}
              <span>{!isOnline ? 'Enfileirar' : 'Enviar'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const s: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 850,
    backgroundColor: 'rgba(5, 7, 11, 0.8)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },
  modal: {
    width: '100%',
    maxWidth: '680px',
    maxHeight: '88vh',
    borderRadius: '16px',
    border: '1px solid var(--border-accent)',
    backgroundColor: 'var(--bg-secondary)',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.65)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '14px 18px',
    borderBottom: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    flexWrap: 'wrap',
  },
  badgeDot: {
    width: '10px',
    height: '10px',
    borderRadius: '999px',
    backgroundColor: '#f97316',
    boxShadow: '0 0 12px #f97316',
  },
  hudStage: {
    padding: '20px 18px 16px',
    background: 'radial-gradient(circle at 50% 28%, rgba(249, 115, 22, 0.16), rgba(11, 13, 18, 0.4) 68%)',
    borderBottom: '1px solid var(--border-color)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
  },
  arcRingOuter: {
    width: '92px',
    height: '92px',
    borderRadius: '999px',
    border: '3px solid #f97316',
    background: 'radial-gradient(circle, rgba(249,115,22,0.35) 0%, rgba(11,13,18,0.95) 75%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'box-shadow 180ms ease, transform 180ms ease',
  },
  arcRingInner: {
    width: '62px',
    height: '62px',
    borderRadius: '999px',
    background: 'linear-gradient(135deg, #f97316 0%, #c2410c 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 10px',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-secondary)',
    fontSize: '0.73rem',
    cursor: 'pointer',
  },
  transcriptBox: {
    flex: 1,
    minHeight: '140px',
    maxHeight: '240px',
    overflowY: 'auto',
    padding: '14px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    backgroundColor: 'var(--bg-secondary)',
  },
  composer: {
    padding: '12px 16px',
    borderTop: '1px solid var(--border-color)',
    backgroundColor: 'var(--bg-primary)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  attachmentPill: {
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 10px',
    borderRadius: '6px',
    backgroundColor: 'var(--accent-soft)',
    border: '1px solid var(--border-accent)',
    color: 'var(--accent-light)',
    fontSize: '0.74rem',
    fontFamily: 'var(--font-mono)',
  },
  input: {
    flex: 1,
    padding: '9px 12px',
    borderRadius: '8px',
    backgroundColor: 'var(--bg-input)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontSize: '0.82rem',
    outline: 'none',
  },
};
