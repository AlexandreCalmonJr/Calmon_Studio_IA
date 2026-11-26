import React, { useEffect, useState } from 'react';

export const VOICE_HUD_TOGGLE_EVENT = 'jarvis:toggle-voice-hud';
export const VOICE_HUD_STATE_EVENT = 'jarvis:voice-hud-state';

interface AiOrbButtonProps {
  assistantName?: string;
  active?: boolean;
  onClick?: () => void;
  centered?: boolean;
}

/**
 * Animated circular AI Orb with the letter "C", synced across all topbars.
 */
export const AiOrbButton: React.FC<AiOrbButtonProps> = ({
  assistantName = 'Calmon IA',
  active,
  onClick,
  centered = false,
}) => {
  const [syncedActive, setSyncedActive] = useState(false);

  useEffect(() => {
    if (typeof active === 'boolean') return;
    const handleState = (ev: Event) => {
      const detail = (ev as CustomEvent<{ active?: boolean }>).detail;
      setSyncedActive(Boolean(detail?.active));
    };
    window.addEventListener(VOICE_HUD_STATE_EVENT, handleState);
    return () => window.removeEventListener(VOICE_HUD_STATE_EVENT, handleState);
  }, [active]);

  const isActive = typeof active === 'boolean' ? active : syncedActive;

  const handleClick = () => {
    if (onClick) {
      onClick();
      return;
    }
    window.dispatchEvent(new CustomEvent(VOICE_HUD_TOGGLE_EVENT));
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`jarvis-ai-orb-btn ${centered ? 'jarvis-ai-orb-btn--centered' : ''} ${isActive ? 'is-active' : ''}`}
      title={
        isActive
          ? `Voz ativa ("Ei ${assistantName}") · Clique para alternar`
          : `Falar com ${assistantName} (Ctrl+Shift+J)`
      }
      aria-label={`Falar com ${assistantName}`}
      aria-pressed={isActive}
    >
      <span className="jarvis-ai-orb-ring" aria-hidden="true" />
      <span className="jarvis-ai-orb-sphere" aria-hidden="true">
        <span className="jarvis-ai-orb-letter">C</span>
      </span>
    </button>
  );
};
