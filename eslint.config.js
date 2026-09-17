import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  // The engine's two legacy files are large, pre-existing, and deliberately
  // untouched by this branch (it must stay synchronous) -- narrowed here
  // rather than left as a blanket src/engine/** ignore so the modules this
  // branch actually added or changed (supabaseClient.js, auth.js, sync.js,
  // games.js, handStore.js, ...) get linted like everything else.
  { ignores: ['dist/**', 'src/engine/initializePokerTrainer.js', 'src/engine/table.js'] },
  {
    files: ['**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaVersion: 'latest', ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
];
