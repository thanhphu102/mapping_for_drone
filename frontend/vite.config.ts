import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/command': {
        target: 'http://127.0.0.1:9002',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:9002',
        ws: true,
      },
    },
  },
})
