import express, { Request, Response, Router } from 'express';
import { serverState, requireAuth } from '../serverState.ts';
import {
  SPREADSHEET_PRESETS,
  SpreadsheetPresetInfo,
  SpreadsheetSpec,
  spreadsheetToCsv,
} from '../../src/services/spreadsheetEngine.ts';
import {
  generateSpreadsheetSpec,
  renderSpreadsheetToXlsxBuffer,
} from '../spreadsheetServer.ts';
import {
  GeneratedImageAsset,
  VideoJobStoreEntry,
  generateStudioImage,
  startStudioVideoJob,
} from '../mediaEngine.ts';
import { isGeminiApiConfigured } from '../hybridAiEngine.ts';

export function createMediaRouter(): Router {
  const router = express.Router();

  // ==================== ESTÚDIO CRIATIVO: PLANILHAS EXCEL (.XLSX/.CSV) & MÍDIA GEMINI ====================
  router.get('/spreadsheets', requireAuth, (_req: Request, res: Response) => {
    const items = Array.from(serverState.spreadsheetStore.values())
      .map((entry) => entry.spec)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({ presets: SPREADSHEET_PRESETS, items });
  });

  router.post('/spreadsheets/generate', requireAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        presetId?: SpreadsheetPresetInfo['id'];
        title?: string;
        useAi?: boolean;
      };
      const spec = await generateSpreadsheetSpec({
        prompt: body.prompt,
        presetId: body.presetId,
        title: body.title,
        useAi: Boolean(body.useAi),
      });
      const xlsxBuffer = await renderSpreadsheetToXlsxBuffer(spec);
      serverState.spreadsheetStore.set(spec.id, { spec, xlsxBuffer });

      // Keep latest 25 spreadsheets in memory
      if (serverState.spreadsheetStore.size > 25) {
        const oldestKey = serverState.spreadsheetStore.keys().next().value;
        if (oldestKey) serverState.spreadsheetStore.delete(oldestKey);
      }

      res.json({
        spreadsheet: spec,
        download_xlsx_url: `/api/v1/spreadsheets/${spec.id}/download?format=xlsx`,
        download_csv_url: `/api/v1/spreadsheets/${spec.id}/download?format=csv`,
      });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Não foi possível gerar a planilha Excel.',
      });
    }
  });

  router.get('/spreadsheets/:id/download', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const sheetIndex = Math.max(0, Number(req.query.sheet || 0) || 0);
    const entry = serverState.spreadsheetStore.get(id);
    if (!entry) {
      res.status(404).json({ error: 'Planilha não encontrada ou expirada.' });
      return;
    }

    const safeSlug =
      entry.spec.title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'planilha-iris';

    if (format === 'csv') {
      const targetSheet = entry.spec.sheets[sheetIndex] || entry.spec.sheets[0];
      const csv = spreadsheetToCsv(targetSheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}.csv"`);
      res.send(csv);
      return;
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}.xlsx"`);
    res.send(entry.xlsxBuffer);
  });

  router.delete('/spreadsheets/:id', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const deleted = serverState.spreadsheetStore.delete(id);
    res.json({ deleted, id });
  });

  router.get('/media/assets', requireAuth, (_req: Request, res: Response) => {
    const videos = Array.from(serverState.videoJobStore.values())
      .map((entry) => entry.job)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json({
      gemini_configured: isGeminiApiConfigured(),
      images: serverState.imageGallery,
      videos,
    });
  });

  router.post('/media/images', requireAuth, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        model?: 'gemini-3.1-flash-lite-image' | 'gemini-nano-banana-2.1';
        aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
        imageSize?: '1K' | '2K' | '4K';
        referenceImageBase64?: string;
        referenceMimeType?: string;
      };
      const asset = await generateStudioImage({
        prompt: String(body.prompt || ''),
        model: body.model,
        aspectRatio: body.aspectRatio,
        imageSize: body.imageSize,
        referenceImageBase64: body.referenceImageBase64,
        referenceMimeType: body.referenceMimeType,
      });
      serverState.imageGallery.unshift(asset);
      if (serverState.imageGallery.length > 24) serverState.imageGallery.pop();
      res.json({ asset });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Falha ao gerar imagem com o modelo Gemini.',
      });
    }
  });

  router.post('/media/videos', requireAuth, (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        prompt?: string;
        aspectRatio?: '16:9' | '9:16';
        duration?: '5s' | '8s' | '10s';
        resolution?: '720p' | '1080p';
        referenceImageBase64?: string;
        referenceMimeType?: string;
        previousInteractionId?: string;
      };
      const job = startStudioVideoJob(serverState.videoJobStore, {
        prompt: String(body.prompt || ''),
        aspectRatio: body.aspectRatio,
        duration: body.duration,
        resolution: body.resolution,
        referenceImageBase64: body.referenceImageBase64,
        referenceMimeType: body.referenceMimeType,
        previousInteractionId: body.previousInteractionId,
      });

      if (serverState.videoJobStore.size > 12) {
        const oldestKey = serverState.videoJobStore.keys().next().value;
        if (oldestKey) serverState.videoJobStore.delete(oldestKey);
      }

      res.status(202).json({ job });
    } catch (err: any) {
      res.status(400).json({
        error: err?.message || 'Não foi possível iniciar a geração de vídeo.',
      });
    }
  });

  router.get('/media/videos/:jobId', requireAuth, (req: Request, res: Response) => {
    const jobId = String(req.params.jobId || '');
    const entry = serverState.videoJobStore.get(jobId);
    if (!entry) {
      res.status(404).json({ error: 'Tarefa de vídeo não encontrada.' });
      return;
    }
    res.json({ job: entry.job });
  });

  router.get('/media/videos/:jobId/file', requireAuth, (req: Request, res: Response) => {
    const jobId = String(req.params.jobId || '');
    const entry = serverState.videoJobStore.get(jobId);
    if (!entry || !entry.buffer) {
      res.status(404).json({ error: 'Arquivo de vídeo ainda não disponível.' });
      return;
    }
    res.setHeader('Content-Type', entry.job.mimeType || 'video/mp4');
    res.setHeader('Content-Disposition', `inline; filename="jarvis-video-${jobId}.mp4"`);
    res.send(entry.buffer);
  });

  router.delete('/media/assets/:id', requireAuth, (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const imgIdx = serverState.imageGallery.findIndex((i) => i.id === id);
    if (imgIdx >= 0) {
      serverState.imageGallery.splice(imgIdx, 1);
      res.json({ deleted: true, id, kind: 'image' });
      return;
    }
    const deletedVideo = serverState.videoJobStore.delete(id);
    res.json({ deleted: deletedVideo, id, kind: 'video' });
  });

  return router;
}
