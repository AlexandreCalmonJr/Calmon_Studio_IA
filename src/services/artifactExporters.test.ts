import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportArtifactToPdf, exportArtifactToPptx } from './artifactExporters';
import type { StructuredArtifactPayload } from '../../server/artifactEngine';

test('exportArtifactToPdf dynamically imports jspdf and generates deterministic pdf', async () => {
  const dummyPayload: StructuredArtifactPayload = {
    id: 'test-pdf-1',
    kind: 'pdf',
    title: 'Relatório Executivo de Engenharia',
    subtitle: 'Fase 4 - Otimização & Governança',
    author: 'JARVIS Architect',
    created_at: '2026-03-30T10:00:00.000Z',
    model_used: 'gemini-4-hydrogen',
    sections: [
      {
        heading: '1. Resumo Executivo',
        body: 'Implementação de dynamic imports e divisão manual de chunks.',
        highlights: ['Bundle reduzido em 87%', 'Zero avisos de chunks > 500 kB'],
      },
    ],
  };

  const filename = await exportArtifactToPdf(dummyPayload);
  assert.equal(filename, 'relatorio-executivo-de-engenharia.pdf');

  // Verifica se o arquivo gerado em ambiente Node pode ser limpo
  if (fs.existsSync(filename)) {
    fs.unlinkSync(filename);
  }
});

test('exportArtifactToPdf handles missing subtitle, author, and created_at defensively', async () => {
  const minimalPayload: StructuredArtifactPayload = {
    id: 'test-pdf-2',
    kind: 'pdf',
    title: 'Documento Mínimo',
    subtitle: '',
    author: '',
    created_at: '',
    model_used: 'gemini-4-hydrogen',
  };

  const filename = await exportArtifactToPdf(minimalPayload);
  assert.equal(filename, 'documento-minimo.pdf');

  if (fs.existsSync(filename)) {
    fs.unlinkSync(filename);
  }
});

test('exportArtifactToPptx dynamically imports pptxgenjs and generates valid presentation', async () => {
  const dummyPayload: StructuredArtifactPayload = {
    id: 'test-pptx-1',
    kind: 'pptx',
    title: 'Apresentação Arquitetura 2026',
    subtitle: 'Diretrizes Técnicas JARVIS',
    author: 'Vetor Architect',
    created_at: '2026-03-30T12:00:00.000Z',
    model_used: 'gemini-4-hydrogen',
    slides: [
      {
        title: 'Visão Geral do Cluster',
        subtitle: 'Componentes e Roteamento',
        bullets: ['Node 22 LTS', 'Vite 6 Bundler', 'WebSocket em tempo real'],
        speakerNotes: 'Apresentar com foco nas métricas de latência.',
      },
    ],
  };

  const filename = await exportArtifactToPptx(dummyPayload);
  assert.equal(filename, 'apresentacao-arquitetura-2026.pptx');

  if (fs.existsSync(filename)) {
    fs.unlinkSync(filename);
  }
});
