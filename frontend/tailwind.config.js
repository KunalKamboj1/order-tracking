/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        shopify: {
          green: '#00A651',
          'green-dark': '#008A42',
          purple: '#7B68EE',
          'purple-dark': '#6B5ACD',
        },
      },
    },
  },
  plugins: [],
}