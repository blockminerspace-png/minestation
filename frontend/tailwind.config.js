export default {
  content: [
    './index.html',
    './src/index.tsx',
    './src/App.tsx',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/constants/**/*.{js,ts,jsx,tsx}',
    './src/controllers/**/*.{js,ts,jsx,tsx}',
    './src/lib/**/*.{js,ts,jsx,tsx}',
    './src/models/**/*.{js,ts,jsx,tsx}',
    './src/services/**/*.{js,ts,jsx,tsx}',
    './src/stores/**/*.{js,ts,jsx,tsx}',
    './src/utils/**/*.{js,ts,jsx,tsx}',
    './src/validation/**/*.{js,ts,jsx,tsx}'
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
