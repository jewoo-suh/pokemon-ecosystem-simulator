import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // For GitHub Pages: set base to repo name
  // Change 'pokemon-ecosystem-simulator' to your actual repo name
  base: process.env.GITHUB_PAGES ? '/pokemon-ecosystem-simulator/' : '/',
})
