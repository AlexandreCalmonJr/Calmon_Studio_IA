export interface MarkdownSegment {
  type: 'text' | 'code';
  content: string;
  language?: string;
  isStreaming?: boolean;
}

export type MarkdownBlock =
  | { type: 'hr' }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'alert'; detail: string }
  | { type: 'paragraph'; text: string };

/**
 * Divide o markdown em trechos de texto e blocos de código cercados por ```.
 * Suporta tanto blocos fechados quanto blocos ainda abertos durante streaming.
 */
export function splitCodeFenceSegments(text: string): MarkdownSegment[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n');
  const segments: MarkdownSegment[] = [];
  const closedRegex = /```([a-zA-Z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = closedRegex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: normalized.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'code',
      language: (match[1] || 'plaintext').trim() || 'plaintext',
      content: match[2],
      isStreaming: false,
    });
    lastIndex = match.index + match[0].length;
  }

  const tail = normalized.slice(lastIndex);
  if (tail.length > 0) {
    const openFenceMatch = tail.match(/(^|\n)```([a-zA-Z0-9_+#.-]*)[ \t]*\n([\s\S]*)$/);
    if (openFenceMatch && typeof openFenceMatch.index === 'number') {
      const fenceStart = openFenceMatch.index + openFenceMatch[1].length;
      const beforeFence = tail.slice(0, fenceStart);
      if (beforeFence.length > 0) {
        segments.push({ type: 'text', content: beforeFence });
      }
      segments.push({
        type: 'code',
        language: (openFenceMatch[2] || 'plaintext').trim() || 'plaintext',
        content: openFenceMatch[3],
        isStreaming: true,
      });
    } else {
      segments.push({ type: 'text', content: tail });
    }
  }

  return segments;
}

function splitTableRow(line: string): string[] {
  const cleaned = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return cleaned.split('|').map((cell) => cell.trim());
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(trimmed);
}

/**
 * Converte texto markdown (sem cercas de código) em blocos estruturados,
 * incluindo tabelas GFM, blockquotes, listas, cabeçalhos, alertas JSON e parágrafos.
 */
export function parseMarkdownBlocks(rawText: string): MarkdownBlock[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let currentList: { type: 'ul' | 'ol'; items: string[] } | null = null;
  let currentQuote: string[] | null = null;

  const flushList = () => {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  };

  const flushQuote = () => {
    if (currentQuote) {
      blocks.push({ type: 'blockquote', lines: currentQuote });
      currentQuote = null;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      flushQuote();
      i += 1;
      continue;
    }

    // Tabela GFM: linha com | seguida de separador |---|---|
    if (
      trimmed.includes('|') &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      flushList();
      flushQuote();
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|')) break;
        const cells = splitTableRow(rowLine);
        while (cells.length < headers.length) cells.push('');
        rows.push(cells.slice(0, headers.length));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Bloco JSON de erro/status serializado
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.detail === 'string' && parsed.detail.trim()) {
          flushList();
          flushQuote();
          blocks.push({ type: 'alert', detail: parsed.detail });
          i += 1;
          continue;
        }
      } catch {
        // segue como parágrafo normal
      }
    }

    // Divisor horizontal
    if (trimmed === '---' || trimmed === '***') {
      flushList();
      flushQuote();
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    // Blockquote (> ...)
    if (trimmed.startsWith('> ') || trimmed === '>') {
      flushList();
      const quoteContent = trimmed === '>' ? '' : trimmed.slice(2);
      if (!currentQuote) currentQuote = [];
      currentQuote.push(quoteContent);
      i += 1;
      continue;
    } else {
      flushQuote();
    }

    // Cabeçalhos
    if (trimmed.startsWith('### ')) {
      flushList();
      blocks.push({ type: 'heading', level: 3, text: trimmed.slice(4) });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push({ type: 'heading', level: 2, text: trimmed.slice(3) });
      i += 1;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      blocks.push({ type: 'heading', level: 1, text: trimmed.slice(2) });
      i += 1;
      continue;
    }

    // Listas não ordenadas
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const itemContent = trimmed.slice(2);
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(itemContent);
      i += 1;
      continue;
    }

    // Listas ordenadas
    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      const itemContent = orderedMatch[2];
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(itemContent);
      i += 1;
      continue;
    }

    // Parágrafo normal
    flushList();
    blocks.push({ type: 'paragraph', text: trimmed });
    i += 1;
  }

  flushList();
  flushQuote();
  return blocks;
}
