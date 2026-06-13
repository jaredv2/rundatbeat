export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        rdb: {
          bg: '#0f1218',
          surface: '#1e2333',
          border: 'rgba(255, 255, 255, 0.12)',
          orange: '#F5A623',
          green: '#2ECC71',
          text: '#e8eaf0',
          muted: '#6b7394',
          red: '#E74C3C',
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
