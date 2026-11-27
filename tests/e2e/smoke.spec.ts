import { expect, test } from '@playwright/test';

test.describe('Calmon Studio Smoke E2E', () => {
  test('carrega interface principal e responde health check', async ({ page, request }) => {
    const health = await request.get('/api/v1/system/health');
    expect(health.status()).toBe(200);
    const body = await health.json();
    expect(body.status).toBe('healthy');

    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('rotas protegidas exigem autenticação e workspace symbols degrada graciosamente', async ({ request }) => {
    const unauthSymbols = await request.post('/api/v1/workspace/symbols', {
      data: { project_path: '.' },
    });
    expect([401, 403]).toContain(unauthSymbols.status());
  });
});

