import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  // CRITICAL: base must be './' (not '/') for Capacitor Android WebView.
  // Absolute paths (/assets/...) fail in the APK — WebView cannot resolve from root.
  // Relative paths (./assets/...) work correctly in both browser dev and APK.
  base: './',
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
  build: {
    // Suppress the 500kB warning for the main bundle (2MB is expected for this app)
    chunkSizeWarningLimit: 2500,
  },
})
