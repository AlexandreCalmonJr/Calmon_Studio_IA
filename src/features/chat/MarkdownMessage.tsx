import React, { useState } from 'react';
import { Copy, Check, Terminal, GitCompare } from 'lucide-react';
import { formatFriendlyText, sanitizeUserFacingText } from '../../types';
import { parseMarkdownBlocks, splitCodeFenceSegments } from './markdownParser';

interface MarkdownMessageProps {
  content: string;
}

const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Só devolve um href para esquemas seguros. Saída de modelo (ou conteúdo
 * externo que chegue ao modelo) pode emitir `javascript:`/`data:`, que
 * executariam código ao clique.
 */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    // Base fictícia: links relativos ficam resolvidos como https e são rejeitados.
    const url = new URL(value, 'https://jarvis.invalid');
    if (!ALLOWED_LINK_PROTOCOLS.has(url.protocol)) return null;
    return value;
  } catch {
    return null;
  }
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = React.memo(({ content }) => {
  // Parser de blocos (código fechado ou em streaming, tabelas GFM, citações, cabeçalhos, listas, parágrafos)
  const renderFormattedText = (text: string) => {
    const segments = splitCodeFenceSegments(text);
    return segments.map((segment, idx) => {
      if (segment.type === 'code') {
        return (
          <CodeBlockItem
            key={`code-${idx}`}
            language={segment.language || 'plaintext'}
            code={segment.content}
            isStreaming={segment.isStreaming}
          />
        );
      }
      return (
        <React.Fragment key={`text-${idx}`}>
          {renderTextSections(segment.content, `seg-${idx}`)}
        </React.Fragment>
      );
    });
  };

  // Renderiza seções de texto normais (tabelas, citações, cabeçalhos, listas, parágrafos)
  const renderTextSections = (rawText: string, keyPrefix: string) => {
    const blocks = parseMarkdownBlocks(rawText);
    return blocks.map((block, idx) => {
      const key = `${keyPrefix}-${block.type}-${idx}`;

      if (block.type === 'alert') {
        return (
          <div
            key={key}
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fca5a5',
              fontSize: '0.86rem',
              margin: '8px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span>
              <strong>Status do Sistema:</strong> {block.detail}
            </span>
          </div>
        );
      }

      if (block.type === 'hr') {
        return (
          <hr
            key={key}
            style={{
              border: 'none',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              margin: '16px 0',
            }}
          />
        );
      }

      if (block.type === 'blockquote') {
        return (
          <blockquote
            key={key}
            style={{
              margin: '10px 0 12px',
              padding: '8px 14px',
              borderLeft: '3px solid var(--accent-color)',
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '0 8px 8px 0',
              color: 'var(--text-secondary)',
              fontSize: '0.88rem',
              lineHeight: 1.55,
            }}
          >
            {block.lines.map((qLine, qIdx) => (
              <div key={qIdx}>{qLine ? renderInlineMarkdown(qLine) : <br />}</div>
            ))}
          </blockquote>
        );
      }

      if (block.type === 'table') {
        return (
          <div
            key={key}
            style={{
              margin: '12px 0 16px',
              overflowX: 'auto',
              borderRadius: '10px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.84rem',
                textAlign: 'left',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-tertiary)', borderBottom: '1px solid var(--border-color)' }}>
                  {block.headers.map((header, hIdx) => (
                    <th
                      key={hIdx}
                      style={{
                        padding: '9px 12px',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {renderInlineMarkdown(header)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    style={{
                      borderTop: rIdx > 0 ? '1px solid var(--border-subtle)' : undefined,
                    }}
                  >
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        style={{
                          padding: '8px 12px',
                          color: 'var(--text-secondary)',
                          verticalAlign: 'top',
                          lineHeight: 1.45,
                        }}
                      >
                        {renderInlineMarkdown(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }

      if (block.type === 'heading') {
        if (block.level === 3) {
          return (
            <div
              key={key}
              className="claude-serif-title"
              style={{
                marginTop: '16px',
                marginBottom: '8px',
                paddingBottom: '4px',
                fontSize: '1.05rem',
                fontWeight: 600,
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {renderInlineMarkdown(block.text)}
            </div>
          );
        }
        if (block.level === 2) {
          return (
            <h3
              key={key}
              className="claude-serif-title"
              style={{
                marginTop: '18px',
                marginBottom: '8px',
                fontSize: '1.2rem',
                fontWeight: 500,
                color: 'var(--text-primary)',
              }}
            >
              {renderInlineMarkdown(block.text)}
            </h3>
          );
        }
        return (
          <h2
            key={key}
            className="claude-serif-title"
            style={{
              marginTop: '20px',
              marginBottom: '10px',
              fontSize: '1.4rem',
              fontWeight: 500,
              color: 'var(--text-primary)',
            }}
          >
            {renderInlineMarkdown(block.text)}
          </h2>
        );
      }

      if (block.type === 'ul') {
        return (
          <ul
            key={key}
            style={{
              margin: '8px 0 12px 20px',
              paddingLeft: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {block.items.map((it, i) => (
              <li key={i} style={{ lineHeight: '1.5' }}>
                {renderInlineMarkdown(it)}
              </li>
            ))}
          </ul>
        );
      }

      if (block.type === 'ol') {
        return (
          <ol
            key={key}
            style={{
              margin: '8px 0 12px 22px',
              paddingLeft: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            {block.items.map((it, i) => (
              <li key={i} style={{ lineHeight: '1.5' }}>
                {renderInlineMarkdown(it)}
              </li>
            ))}
          </ol>
        );
      }

      return (
        <p
          key={key}
          style={{
            marginBottom: '8px',
            lineHeight: '1.6',
            fontSize: '0.9rem',
            color: 'var(--text-primary)',
          }}
        >
          {renderInlineMarkdown(block.text)}
        </p>
      );
    });
  };

  // Parser inline: transforma **negrito**, *itálico*, `código` em elementos reais HTML
  const renderInlineMarkdown = (text: string): React.ReactNode => {
    // Regex para tokens: `código`, ***negrito e itálico***, **negrito**, *itálico*, links
    const parts: React.ReactNode[] = [];
    const tokenRegex = /(`[^`]+`|\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(text.substring(lastIdx, match.index));
      }

      const token = match[0];
      if (token.startsWith('`') && token.endsWith('`')) {
        const rawCode = token.slice(1, -1);
        parts.push(
          <code
            key={`inline-code-${match.index}`}
            style={{
              backgroundColor: 'var(--accent-soft)',
              padding: '2px 7px',
              borderRadius: '5px',
              fontSize: '0.82rem',
              color: 'var(--accent-light)',
              fontFamily: "'JetBrains Mono', monospace",
              border: '1px solid var(--border-accent)',
            }}
          >
            {formatFriendlyText(rawCode)}
          </code>
        );
      } else if (token.startsWith('***') && token.endsWith('***')) {
        parts.push(
          <strong key={`bold-italic-${match.index}`} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            <em style={{ fontStyle: 'italic' }}>{token.slice(3, -3)}</em>
          </strong>
        );
      } else if (token.startsWith('**') && token.endsWith('**')) {
        parts.push(
          <strong key={`bold-${match.index}`} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            {token.slice(2, -2)}
          </strong>
        );
      } else if (token.startsWith('*') && token.endsWith('*')) {
        parts.push(
          <em key={`italic-${match.index}`} style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>
            {token.slice(1, -1)}
          </em>
        );
      } else if (token.startsWith('[') && token.includes('](')) {
        const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
        const href = linkMatch ? safeHref(linkMatch[2]) : null;
        if (linkMatch && href) {
          parts.push(
            <a
              key={`link-${match.index}`}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: 'var(--accent-color)',
                textDecoration: 'underline',
                textUnderlineOffset: '3px',
              }}
            >
              {linkMatch[1]}
            </a>
          );
        } else if (linkMatch) {
          // Esquema não permitido: mostra o texto, nunca o link.
          parts.push(
            <span key={`link-blocked-${match.index}`} title="Link bloqueado por segurança">
              {linkMatch[1]} ({linkMatch[2]})
            </span>
          );
        } else {
          parts.push(token);
        }
      }

      lastIdx = match.index + token.length;
    }

    if (lastIdx < text.length) {
      parts.push(text.substring(lastIdx));
    }

    return parts;
  };

  const safeContent = sanitizeUserFacingText(content);
  return <div style={{ wordBreak: 'break-word' }}>{renderFormattedText(safeContent)}</div>;
});

// Componente para blocos de código com botão de cópia e realce
const CodeBlockItem: React.FC<{ language: string; code: string; isStreaming?: boolean }> = React.memo(({ language, code, isStreaming }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isDiff = language === 'diff';
  const lines = code.split('\n');

  return (
    <div
      style={{
        margin: '12px 0 16px',
        borderRadius: '10px',
        backgroundColor: '#161514',
        border: '1px solid var(--border-color)',
        overflow: 'hidden',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.4)',
      }}
    >
      <div
        style={{
          padding: '8px 14px',
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isDiff ? <GitCompare size={14} color="var(--accent-color)" /> : <Terminal size={14} color="var(--accent-color)" />}
          <span style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>
            {language.toUpperCase() || 'CÓDIGO'}
          </span>
          {isStreaming && (
            <span style={{ fontSize: '0.68rem', color: 'var(--accent-light)', opacity: 0.9 }}>
              (gerando...)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className={`btn btn-xs ${copied ? 'btn-success' : 'btn-ghost'}`}
          title="Copiar código"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copiado!' : 'Copiar'}</span>
        </button>
      </div>

      <div
        style={{
          padding: '12px 14px',
          overflowX: 'auto',
          maxHeight: '420px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.82rem',
          lineHeight: '1.55',
        }}
      >
        {isDiff ? (
          lines.map((line, idx) => {
            let cls = '';
            if (line.startsWith('+') && !line.startsWith('+++')) cls = 'diff-line-add';
            else if (line.startsWith('-') && !line.startsWith('---')) cls = 'diff-line-del';
            else if (line.startsWith('@@') || line.startsWith('diff')) cls = 'diff-line-info';

            return (
              <div key={idx} className={cls} style={{ padding: '1px 8px', whiteSpace: 'pre' }}>
                {line || ' '}
              </div>
            );
          })
        ) : (
          <pre style={{ margin: 0, whiteSpace: 'pre', color: 'var(--text-primary)' }}>{code}</pre>
        )}
      </div>
    </div>
  );
});
