import { useCallback, useEffect, useRef, useState } from 'react';
import { getAccountStorageKey } from '../services/accountScope';
import { detectWakeWord } from '../services/voiceCompanion';
import { notify } from '../shared/common/Toast';

export const WAKE_WORD_PREF_KEY = 'jarvis_pref_wake_word_enabled';
export const VOICE_AUTO_SPEAK_PREF_KEY = 'jarvis_pref_voice_auto_speak';

export function getWakeWordEnabledPref(): boolean {
  try {
    return localStorage.getItem(getAccountStorageKey(WAKE_WORD_PREF_KEY)) === 'true';
  } catch {
    return false;
  }
}

export function setWakeWordEnabledPref(enabled: boolean): void {
  try {
    localStorage.setItem(getAccountStorageKey(WAKE_WORD_PREF_KEY), String(enabled));
    window.dispatchEvent(new Event('jarvis_voice_prefs_changed'));
  } catch {}
}

export function getVoiceAutoSpeakPref(): boolean {
  try {
    const raw = localStorage.getItem(getAccountStorageKey(VOICE_AUTO_SPEAK_PREF_KEY));
    return raw !== null ? raw !== 'false' : true;
  } catch {
    return true;
  }
}

export function setVoiceAutoSpeakPref(enabled: boolean): void {
  try {
    localStorage.setItem(getAccountStorageKey(VOICE_AUTO_SPEAK_PREF_KEY), String(enabled));
    window.dispatchEvent(new Event('jarvis_voice_prefs_changed'));
  } catch {}
}

export interface UseWakeWordListenerOptions {
  assistantName: string;
  paused: boolean;
  onWakeDetected: (payload: { command: string; triggerPhrase: string }) => void;
}

export interface UseWakeWordListenerReturn {
  enabled: boolean;
  supported: boolean;
  listening: boolean;
  permissionError: string | null;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
}

function getSpeechRecognitionCtor(): any {
  if (typeof window === 'undefined') return null;
  return (
    (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition ||
    null
  );
}

/**
 * Escuta passiva por palavra de ativação ("Ei JARVIS", "Oi Luna", etc.).
 * Pausa automaticamente quando o HUD de voz está aberto para evitar conflito de microfone.
 */
export function useWakeWordListener({
  assistantName,
  paused,
  onWakeDetected,
}: UseWakeWordListenerOptions): UseWakeWordListenerReturn {
  const [enabled, setEnabledState] = useState<boolean>(() => getWakeWordEnabledPref());
  const [listening, setListening] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const supported = Boolean(getSpeechRecognitionCtor());
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<number | null>(null);
  const onWakeRef = useRef(onWakeDetected);
  const assistantNameRef = useRef(assistantName);
  const enabledRef = useRef(enabled);
  const pausedRef = useRef(paused);

  onWakeRef.current = onWakeDetected;
  assistantNameRef.current = assistantName;
  enabledRef.current = enabled;
  pausedRef.current = paused;

  useEffect(() => {
    const sync = () => setEnabledState(getWakeWordEnabledPref());
    window.addEventListener('jarvis_voice_prefs_changed', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('jarvis_voice_prefs_changed', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const stopRecognizer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setListening(false);
  }, []);

  useEffect(() => {
    if (!enabled || paused) {
      stopRecognizer();
      return;
    }

    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) {
      setListening(false);
      setPermissionError('Reconhecimento contínuo indisponível neste navegador.');
      return;
    }

    let cancelled = false;

    const startRecognizer = () => {
      if (cancelled || !enabledRef.current || pausedRef.current) return;
      stopRecognizer();
      try {
        const rec = new SpeechRecognitionCtor();
        rec.lang = 'pt-BR';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        rec.onstart = () => {
          if (!cancelled) {
            setListening(true);
            setPermissionError(null);
          }
        };

        rec.onresult = (event: any) => {
          if (cancelled || pausedRef.current) return;
          for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const result = event.results[i];
            const transcript = result?.[0]?.transcript || '';
            if (!transcript.trim()) continue;
            const detection = detectWakeWord(transcript, assistantNameRef.current);
            if (detection.detected) {
              // Se o usuário falou um comando completo, aguarda finalizar o trecho ou dispara quando for final
              if (result.isFinal || !detection.command) {
                stopRecognizer();
                onWakeRef.current({
                  command: detection.command,
                  triggerPhrase: detection.triggerPhrase || `Ei ${assistantNameRef.current}`,
                });
                return;
              }
            }
          }
        };

        rec.onerror = (event: any) => {
          const errCode = event?.error || '';
          if (errCode === 'not-allowed' || errCode === 'service-not-allowed') {
            setPermissionError('Permita o uso do microfone no navegador para ativação por voz.');
            setWakeWordEnabledPref(false);
            setEnabledState(false);
            stopRecognizer();
            notify('Permissão de microfone bloqueada pelo navegador.', 'warning');
            return;
          }
          setListening(false);
        };

        rec.onend = () => {
          setListening(false);
          if (!cancelled && enabledRef.current && !pausedRef.current) {
            restartTimerRef.current = window.setTimeout(startRecognizer, 900);
          }
        };

        recognitionRef.current = rec;
        rec.start();
      } catch {
        setListening(false);
      }
    };

    startRecognizer();

    return () => {
      cancelled = true;
      stopRecognizer();
    };
  }, [enabled, paused, assistantName, stopRecognizer]);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (next && !getSpeechRecognitionCtor()) {
        setWakeWordEnabledPref(false);
        setEnabledState(false);
        notify(
          `A escuta contínua por microfone depende do Chrome/Edge com permissão de áudio. Você ainda pode clicar em "Ei ${assistantName}" a qualquer momento.`,
          'info'
        );
        return;
      }
      setPermissionError(null);
      setWakeWordEnabledPref(next);
      setEnabledState(next);
      notify(
        next
          ? `Escuta ativa: diga "Ei ${assistantName}" a qualquer momento.`
          : `Escuta por palavra de ativação pausada.`,
        'info'
      );
    },
    [assistantName]
  );

  const toggle = useCallback(() => {
    setEnabled(!enabled);
  }, [enabled, setEnabled]);

  return {
    enabled,
    supported,
    listening,
    permissionError,
    setEnabled,
    toggle,
  };
}
