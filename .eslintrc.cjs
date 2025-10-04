module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript'
  ],
  settings: {
    'import/resolver': {
      typescript: {
        project: [
          'tsconfig.base.json',
          'packages/*/tsconfig.json',
          'packages/*/tsconfig.eslint.json'
        ],
        alwaysTryTypes: true
      },
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx']
      }
    }
  },
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    'import/default': 'off'
  }
};
