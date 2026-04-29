export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neon: {
          gold: '#eab308',
          purple: '#a855f7',
          cyan: '#06b6d4',
          green: '#22c55e',
        }
      }
    },
  },
  plugins: [],
  darkMode: 'class',
}
