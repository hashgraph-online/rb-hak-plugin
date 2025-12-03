module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json'
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    jest: true
  },
  ignorePatterns: ['dist', 'coverage'],
  rules: {
    '@typescript-eslint/explicit-function-return-type': 'off'
  }
};
