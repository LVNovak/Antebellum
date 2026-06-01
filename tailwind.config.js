/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Period-appropriate earth tone palette from the GDD
      colors: {
        earth: {
          50:  '#faf6f0',
          100: '#f0e8d6',
          200: '#ddd0b0',
          300: '#c8b48a',
          400: '#b09060',
          500: '#8b6f42',
          600: '#6e5230',
          700: '#5c3a1e',  // Primary brown — headers, borders
          800: '#3b1f0a',  // Dark brown — main text
          900: '#1e0f05',
        },
        soil: {
          good:      '#5a7a3a',  // Healthy soil — green
          fair:      '#a8852a',  // Moderate soil — amber
          poor:      '#b85c2a',  // Depleted soil — orange-red
          exhausted: '#6b6b6b',  // Exhausted soil — grey
        },
        health: {
          healthy:  '#4a7c59',
          tired:    '#8a7a2a',
          weak:     '#b87030',
          sick:     '#b84040',
          verySick: '#8b1a1a',
        }
      },
      fontFamily: {
        // Serif for headers and ledger numbers — period feel
        serif: ['Georgia', 'Cambria', 'serif'],
        // Sans for UI labels and small text — readability
        sans:  ['system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
