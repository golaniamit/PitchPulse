/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          800: '#1a1a2e',
          700: '#16213e',
          600: '#0f3460',
        },
        yes: {
          DEFAULT: '#2e7d32',
          light: '#4caf50',
          bg: '#e8f5e9',
        },
        no: {
          DEFAULT: '#c62828',
          light: '#ef5350',
          bg: '#ffebee',
        },
      },
    },
  },
  plugins: [],
};
