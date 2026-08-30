export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.vinext/**', '.wrangler/**', '.pnpm-store/**', 'ai-slide-generator/**'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    // 建置腳本在 Node 執行，需要 console/process/URL 等全域
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly', fetch: 'readonly' },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];
