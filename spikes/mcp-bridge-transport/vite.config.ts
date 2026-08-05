import { defineConfig } from 'vite'
import { switchboardBridge } from './src/bridge/vite-plugin.js'

export default defineConfig({
  // Decision 13: localhost binding (Vite's default host is localhost; stated
  // explicitly here because the spike is evidence).
  server: { host: 'localhost', port: 5173, strictPort: true },
  plugins: [switchboardBridge()],
})
