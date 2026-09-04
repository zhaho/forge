/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/views/**/*.ejs', './src/public/js/**/*.js'],
  theme: {
    extend: {},
  },
  plugins: [require('daisyui')],
  daisyui: {
    themes: [
      {
        forge: {
          primary: '#F7941D',
          secondary: '#ED1C24',
          accent: '#F7941D',
          neutral: '#191E24',
          'base-100': '#15191E',
          'base-200': '#1D2229',
          'base-300': '#262C34',
          info: '#3ABFF8',
          success: '#36D399',
          warning: '#FBBD23',
          error: '#F87272',
        },
      },
    ],
  },
};
