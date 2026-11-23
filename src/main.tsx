import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installSessionTransport } from './services/sessionTransport';
import { initDynamicTheme } from './services/themeEngine';
import { registerSW } from 'virtual:pwa-register';

installSessionTransport();
initDynamicTheme();
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
