module.exports = {
  extends: '../../.eslintrc.cjs',
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.eslint.json']
      },
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        moduleDirectory: ['node_modules', '../../packages']
      }
    }
  }
};
