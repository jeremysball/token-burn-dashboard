import js from '@eslint/js';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      },
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'script'
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }]
    }
  },
  {
    files: ['dashboard/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        Plotly: 'readonly'
      }
    }
  },
  {
    files: ['api/**/*.js'],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    files: ['tests/**/*.js', '**/*.spec.js', 'test-*.js'],
    rules: {
      'no-unused-vars': 'off'
    },
    languageOptions: {
      globals: {
        ...globals.jest,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly'
      }
    }
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'dist-dashboard/**', 'coverage/**', 'test-results/**']
  }
];