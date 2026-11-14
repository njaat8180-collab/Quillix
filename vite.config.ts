import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'node:fs';
import {defineConfig, type Plugin} from 'vite';
import { buildContentSecurityPolicy, injectContentSecurityPolicy } from './platform/csp.js';

/**
 * Inject the renderer Content Security Policy into index.html.
 * The production bundle has no inline scripts; the development server needs
 * the Vite React Fast Refresh preamble and the HMR websocket, so the policy
 * is mode aware.
 */
function contentSecurityPolicyPlugin(): Plugin {
  return {
    name: 'nuvro-content-security-policy',
    transformIndexHtml(html, ctx) {
      const mode = ctx.server ? 'development' : 'production';
      return injectContentSecurityPolicy(html, buildContentSecurityPolicy(mode));
    },
  };
}

export default defineConfig(() => {
  return {
    // Relative base so the built app also works when loaded via file:// in Electron.
    base: './',
    plugins: [react(), tailwindcss(), contentSecurityPolicyPlugin(), {
      name: 'local-monaco',
      closeBundle() {
        fs.cpSync(path.resolve('node_modules/monaco-editor/min/vs'), path.resolve('dist/monaco/vs'), { recursive: true });
      },
    }],
    resolve: {
      // React must be a single module instance across the app and the Monaco
      // React wrapper. A duplicate creates React error #321 when the editor
      // first renders in production builds.
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      // HMR can be disabled with DISABLE_HMR when needed.
      // File watching can also be disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          // Keep Monaco's standalone editor runtime out of the first UI chunk.
          // Keep @monaco-editor/react in vendor with the app's React runtime;
          // splitting that React wrapper into its own chunk can leave the
          // renderer and editor using different hook dispatchers (React #321).
          manualChunks(id) {
            if (id.includes('node_modules/monaco-editor/')) return 'monaco';
            if (id.includes('node_modules/')) return 'vendor';
            return undefined;
          },
        },
      },
    },
  };
});
