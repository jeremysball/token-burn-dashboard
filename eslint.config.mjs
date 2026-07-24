import js from '@eslint/js';
import globals from 'globals';
import sonarjs from 'eslint-plugin-sonarjs';

const sonarjsRecommendedWarnings = Object.fromEntries(
  Object.entries(sonarjs.configs.recommended.rules).map(([ruleId, setting]) => {
    if (setting === 'off' || setting === 0) {
      return [ruleId, setting];
    }

    return [ruleId, Array.isArray(setting) ? ['warn', ...setting.slice(1)] : 'warn'];
  })
);

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
      complexity: ['warn', 10],
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 50, skipBlankLines: true, skipComments: true }],
      'max-statements': ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 4],
      'max-nested-callbacks': ['warn', 3]
    }
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        Bun: 'readonly'
      }
    },
    plugins: {
      sonarjs
    },
    rules: sonarjsRecommendedWarnings
  },
  {
    files: ['tests/**/*.js', '**/*.spec.js', 'test-*.js'],
    rules: {
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-duplicate-string': 'off',
      'sonarjs/no-identical-functions': 'off'
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
    languageOptions: {
      globals: {
        Bun: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly'
      }
    }
  },
  {
    ignores: ['node_modules/**', 'dist/**', 'dist-dashboard/**', 'coverage/**', 'test-results/**']
  }
];
