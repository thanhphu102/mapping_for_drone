import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.VITE_BACKEND_TARGET ?? 'http://127.0.0.1:9002'
const backendWsTarget = backendTarget.replace(/^http/, 'ws')
const devHost = process.env.VITE_DEV_HOST ?? '127.0.0.1'
const devPort = Number(process.env.VITE_DEV_PORT ?? '5173')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: devHost,
    port: devPort,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/command': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/debug': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: backendWsTarget,
        ws: true,
      },
    },
  },
})
