export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        rdb: {
          bg: '#050609',
          surface: '#11151d',
          border: 'rgba(255, 196, 0, 0.28)',
          orange: '#ff9d00',
          blue: '#22d3ee',
          text: '#f0f0f0',
          muted: '#8d93a1',
          red: '#ff3d5a',
          discord: '#5865F2',
        },
      },
      fontFamily: {
        mono: ['Space Mono', 'monospace'],
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
