import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Optimizaciones para desarrollo rapido en Windows
  server: {
    port: 5173,
    strictPort: false,
    host: true, // Permite acceso desde red local
  },

  // Optimizaciones de build
  build: {
    target: 'esnext', // Build mas rapido
    sourcemap: false, // Desactivar sourcemaps en prod
    minify: 'esbuild', // esbuild es mas rapido que terser
  },

  // Optimizaciones de desarrollo
  optimizeDeps: {
    // Pre-bundle de dependencias para arranque rapido
    include: ['react', 'react-dom', 'tone'],
  },

  // Evitar problemas con rutas de Windows
  resolve: {
    preserveSymlinks: true,
  },
})
