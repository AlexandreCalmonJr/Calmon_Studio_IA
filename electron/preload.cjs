/**
 * Calmon Studio — Electron Preload Bridge
 * Expõe metadados seguros de ambiente desktop para o frontend sem habilitar nodeIntegration.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('calmonDesktop', {
  isDesktop: true,
  platform: process.platform,
  appVersion: process.env.CALMON_APP_VERSION || '3.0.1',
});
