import { useCallback, useRef, useState } from 'react';
import { transcribeVoiceAudio } from '../services/api';

export function useVoiceCapture() {
  const [offlineRecording, setOfflineRecording] = useState(false);
  const busyRef = useRef(false);

  const recordOfflineTranscript = useCallback(async (durationMs = 3500): Promise<string> => {
    if (busyRef.current) return '';
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      throw new Error('Gravação offline não suportada neste navegador.');
    }

    busyRef.current = true;
    setOfflineRecording(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      const blob = await new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
        };
        recorder.start();
        window.setTimeout(() => {
          if (recorder.state !== 'inactive') recorder.stop();
        }, durationMs);
      });

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const res = String(reader.result || '');
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = () => reject(new Error('Falha ao ler áudio gravado.'));
        reader.readAsDataURL(blob);
      });

      const out = await transcribeVoiceAudio({
        audio_base64: base64,
        mime_type: blob.type || 'audio/webm',
        language: 'pt',
      });
      return (out?.transcript || '').trim();
    } finally {
      busyRef.current = false;
      setOfflineRecording(false);
    }
  }, []);

  return { offlineRecording, recordOfflineTranscript };
}

