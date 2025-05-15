/**
 * ESLint configuration file for the JSReverse project
 */
module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  extends: ['eslint:recommended'],
  rules: {
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-unused-vars': ['warn'],
    'no-console': 'off',
    'no-process-exit': 'off'
  },
  overrides: [
    {
      files: ['tests/**/*.js'],
      env: {
        jest: true
      }
    }
  ]
};