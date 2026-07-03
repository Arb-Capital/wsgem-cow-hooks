import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // CoW Swap loads the dapp in an iframe; allow it during local "My Custom Hooks" testing.
    headers: { 'Access-Control-Allow-Origin': '*' },
  },
})
