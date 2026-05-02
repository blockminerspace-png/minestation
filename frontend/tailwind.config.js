export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace'
        ]
      },
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
