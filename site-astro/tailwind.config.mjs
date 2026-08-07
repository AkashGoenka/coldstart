/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        void: '#070a11',
        ink1: '#0b111c',
        ink2: '#0f1826',
        raised: '#121d2d',
        warmground: '#12100e',
        text: '#e7eef8',
        muted: '#8b9ab2',
        faint: '#5d6b83',
        frost: '#4fbfe0',
        frostdim: '#2f89a8',
        ember: '#ef9448',
        emberdim: '#b96a28',
        ok: '#57cc92',
        line: '#1a2536',
        linewarm: '#2a2218',
      },
      fontFamily: {
        mono: ['SF Mono', 'ui-monospace', 'JetBrains Mono', 'Fira Code', 'Menlo', 'Consolas', 'monospace'],
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
