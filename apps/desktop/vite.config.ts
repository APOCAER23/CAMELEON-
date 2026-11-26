import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict CSP baked into the production HTML (works for file:// where response headers do not apply).
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:", "font-src 'self'", "connect-src 'none'", "object-src 'none'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'cameleon-csp',
  apply: 'build',
  transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), cspPlugin()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true, sourcemap: false, target: 'chrome130' },
  server: { host: '127.0.0.1' },
});
