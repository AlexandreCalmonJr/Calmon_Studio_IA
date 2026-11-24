import React from 'react';
import { Plug, Sparkles, Terminal, Webhook } from 'lucide-react';

interface StoreAppIconProps {
  iconType: string;
  size?: number;
}

export const StoreAppIcon: React.FC<StoreAppIconProps> = ({ iconType, size = 38 }) => {
  const radius = Math.round(size * 0.26);
  const boxStyle: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: `${radius}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  switch (iconType) {
    case 'telegram':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#0284c7' }}>
          <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none">
            <path d="M21.5 2.5L2 10.5l7 3 2 6 4-3.5 5 4.5 1.5-18z" fill="#ffffff" />
          </svg>
        </div>
      );
    case 'whatsapp':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#22c55e' }}>
          <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2C6.48 2 2 6.48 2 12c0 1.94.55 3.75 1.51 5.29L2 22l4.87-1.48C8.34 21.48 10.12 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm4.84 14.18c-.2.57-1.16 1.09-1.63 1.15-.44.06-.99.08-3.18-.79-2.31-.92-3.8-3.26-3.92-3.41-.11-.15-.94-1.25-.94-2.38s.59-1.69.8-1.92c.2-.23.44-.29.59-.29s.3.01.43.02c.14.01.32-.05.5.38.2.47.67 1.63.73 1.75.06.12.1.26.02.41-.08.15-.12.24-.24.38-.12.14-.25.31-.36.42-.12.12-.24.25-.1.5.14.24.62 1.02 1.33 1.65.91.81 1.68 1.06 1.92 1.18.24.12.38.1.52-.06.14-.16.6-.7.76-.94.16-.24.32-.2.53-.12.22.08 1.38.65 1.62.77.24.12.4.18.46.28.06.1.06.59-.14 1.16z"
              fill="#ffffff"
            />
          </svg>
        </div>
      );
    case 'slack':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#ffffff', border: '1px solid var(--border-color)' }}>
          <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24">
            <path
              d="M6 15a2 2 0 0 1-2-2 2 2 0 0 1 2-2h2v2a2 2 0 0 1-2 2zm1 0a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-5z"
              fill="#e01e5a"
            />
            <path
              d="M9 6a2 2 0 0 1-2 2 2 2 0 0 1-2-2 2 2 0 0 1 2-2h2v2zm0 1a2 2 0 0 1 2 2 2 2 0 0 1-2 2H4a2 2 0 0 1-2-2 2 2 0 0 1 2-2h5z"
              fill="#36c5f0"
            />
            <path
              d="M18 9a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2v-2a2 2 0 0 1 2-2zm-1 0a2 2 0 0 1-2 2 2 2 0 0 1-2-2V4a2 2 0 0 1 2-2 2 2 0 0 1 2 2v5z"
              fill="#2eb67d"
            />
            <path
              d="M15 18a2 2 0 0 1 2-2 2 2 0 0 1 2 2 2 2 0 0 1-2 2h-2v-2zm0-1a2 2 0 0 1-2-2 2 2 0 0 1 2-2h5a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-5z"
              fill="#ecb22e"
            />
          </svg>
        </div>
      );
    case 'discord':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#5865f2' }}>
          <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 24 24" fill="#ffffff">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
        </div>
      );
    case '1password':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#0284c7' }}>
          <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
            <circle cx="12" cy="12" r="9" />
            <circle cx="12" cy="12" r="3" />
            <line x1="12" y1="15" x2="12" y2="17" />
          </svg>
        </div>
      );
    case 'bitwarden':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#175ddc' }}>
          <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <rect x="8" y="9" width="8" height="6" rx="1" />
          </svg>
        </div>
      );
    case 'coda':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#ea580c' }}>
          <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 24 24" fill="#ffffff">
            <rect x="4" y="4" width="16" height="16" rx="4" />
            <path d="M14 8h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4" stroke="#ea580c" strokeWidth="2.5" fill="none" />
          </svg>
        </div>
      );
    case 'craft':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#ffffff', border: '1px solid var(--border-color)' }}>
          <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 24 24">
            <rect x="4" y="4" width="7" height="7" rx="2" fill="#2563eb" />
            <rect x="13" y="4" width="7" height="7" rx="2" fill="#7c3aed" />
            <rect x="4" y="13" width="7" height="7" rx="2" fill="#06b6d4" />
            <rect x="13" y="13" width="7" height="7" rx="2" fill="#f43f5e" />
          </svg>
        </div>
      );
    case 'dropbox':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#0061ff' }}>
          <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 24 24" fill="#ffffff">
            <path d="M6 3.5L12 7.5L6 11.5L0 7.5L6 3.5ZM18 3.5L24 7.5L18 11.5L12 7.5L18 3.5ZM0 15.5L6 19.5L12 15.5L6 11.5L0 15.5ZM18 11.5L12 15.5L18 19.5L24 15.5L18 11.5ZM6 20.8L12 16.8L18 20.8L12 24.8L6 20.8Z" />
          </svg>
        </div>
      );
    case 'evernote':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#00a82d' }}>
          <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="#ffffff">
            <path d="M19.5 3H7.5A4.5 4.5 0 0 0 3 7.5v8.78A4.72 4.72 0 0 0 7.72 21H16a5 5 0 0 0 5-5V4.5a1.5 1.5 0 0 0-1.5-1.5zm-5 13H8a1 1 0 0 1 0-2h6.5a1 1 0 0 1 0 2zm2-4H8a1 1 0 0 1 0-2h8.5a1 1 0 0 1 0 2z" />
          </svg>
        </div>
      );
    case 'github':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#18181b', border: '1px solid var(--border-color)' }}>
          <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="#ffffff">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
        </div>
      );
    case 'vercel':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#000000', border: '1px solid var(--border-color)' }}>
          <svg width={size * 0.46} height={size * 0.46} viewBox="0 0 24 24" fill="#ffffff">
            <path d="M12 1L24 22H0L12 1Z" />
          </svg>
        </div>
      );
    case 'canva':
      return (
        <div style={{ ...boxStyle, background: 'linear-gradient(135deg, #00c4cc, #7d2ae8)' }}>
          <span style={{ color: '#ffffff', fontWeight: 800, fontSize: `${size * 0.46}px`, fontFamily: 'serif' }}>
            C
          </span>
        </div>
      );
    case 'context7':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#059669' }}>
          <span style={{ color: '#ffffff', fontWeight: 800, fontSize: `${size * 0.38}px` }}>C7</span>
        </div>
      );
    case 'huggingface':
      return (
        <div style={{ ...boxStyle, backgroundColor: '#eab308' }}>
          <span style={{ color: '#09090b', fontWeight: 800, fontSize: `${size * 0.38}px`, letterSpacing: '-0.02em' }}>
            HF
          </span>
        </div>
      );
    case 'mcp':
      return (
        <div style={{ ...boxStyle, backgroundColor: 'var(--accent-soft)', border: '1px solid var(--border-accent)' }}>
          <Plug size={size * 0.48} color="var(--accent-light)" />
        </div>
      );
    case 'webhook':
      return (
        <div style={{ ...boxStyle, backgroundColor: 'var(--info-soft)', border: '1px solid rgba(56, 189, 248, 0.32)' }}>
          <Webhook size={size * 0.48} color="var(--info-text)" />
        </div>
      );
    case 'custom_tool':
      return (
        <div style={{ ...boxStyle, backgroundColor: 'var(--purple-soft)', border: '1px solid rgba(139, 92, 246, 0.32)' }}>
          <Terminal size={size * 0.48} color="var(--purple-text)" />
        </div>
      );
    default:
      return (
        <div style={{ ...boxStyle, backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)' }}>
          <Sparkles size={size * 0.5} color="var(--accent-light)" />
        </div>
      );
  }
};
