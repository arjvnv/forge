import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standalone Intelligence dashboard — its own dev server, separate from shell/.
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
