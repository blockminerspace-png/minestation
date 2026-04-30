export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neon: {
          gold: '#fbbf24',
          purple: '#ea580c',
          cyan: '#f59e0b',
          green: '#22c55e',
        }
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}
