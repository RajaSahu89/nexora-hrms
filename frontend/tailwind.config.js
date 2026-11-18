/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { primary: '#9CC6E0', accent: '#E4002B', ink: 'var(--text)', muted: 'var(--muted)' },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
      borderRadius: { glass: '20px' },
    },
  },
  plugins: [],
};
