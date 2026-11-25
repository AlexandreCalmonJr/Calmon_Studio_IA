import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Permite apontar o frontend para um backend isolado (ex.: E2E em :8020).
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'qrcode', 'lucide-react'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const norm = id.replace(/\\/g, '/');
          if (norm.includes('node_modules')) {
            if (norm.includes('/react/') || norm.includes('/react-dom/') || norm.includes('/scheduler/')) {
              return 'vendor-react';
            }
            if (norm.includes('/recharts/') || norm.includes('/d3-')) {
              return 'vendor-charts';
            }
            if (norm.includes('/@firebase/firestore') || norm.includes('/firebase/firestore')) {
              return 'vendor-firestore';
            }
            if (norm.includes('/firebase/') || norm.includes('/@firebase/')) {
              return 'vendor-firebase';
            }
            if (norm.includes('/lucide-react/')) {
              return 'vendor-icons';
            }
          }
        },
      },
    },
  },
  plugins: [
    {
      name: 'disable-vite-client-ws-when-hmr-off',
      apply: 'serve',
      transform(code, id) {
        if (id.includes('vite/dist/client/client.mjs')) {
          return {
            code: code.replace(
              /const transport = normalizeModuleRunnerTransport\([\s\S]*?(?=let willUnload = false;)/,
              'const transport = { async connect() {}, async disconnect() {}, async send() {}, async invoke() {} };\n'
            ),
            map: null,
          };
        }
        return null;
      },
    },
    react(),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    hmr: false,
    ws: false,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
