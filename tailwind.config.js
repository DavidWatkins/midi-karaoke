/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        karaoke: {
          bg: '#0a0a1a',
          primary: '#4f46e5',
          accent: '#22d3ee',
          sung: '#6366f1',
          current: '#fbbf24',
          upcoming: '#e2e8f0'
        }
      },
      fontFamily: {
        display: ['system-ui', 'sans-serif'],
        lyrics: ['Georgia', 'serif']
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate'
      },
      keyframes: {
        glow: {
          '0%': { textShadow: '0 0 10px #fbbf24, 0 0 20px #fbbf24' },
          '100%': { textShadow: '0 0 20px #fbbf24, 0 0 40px #fbbf24, 0 0 60px #fbbf24' }
        }
      }
    },
  },
  plugins: [],
}
