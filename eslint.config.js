import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import eslintCommentsPlugin from 'eslint-plugin-eslint-comments';
import functionalPlugin from 'eslint-plugin-functional';
import monorepoCopPlugin from 'eslint-plugin-monorepo-cop';
import prettierConfig from 'eslint-config-prettier';

export default [
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            '**/coverage/**',
            '**/site/**',
            '**/.tsimp/**',
            '**/*.json'
        ]
    },
    {
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: ['./tsconfig.json', './src/*/tsconfig.json'],
                ecmaVersion: 2020,
                sourceType: 'module',
            },
            globals: {
                BigInt: true,
                console: true,
                WebAssembly: true,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'import': importPlugin,
            'eslint-comments': eslintCommentsPlugin,
            'functional': functionalPlugin,
            'monorepo-cop': monorepoCopPlugin,
        },
        settings: {
            'import/parsers': {
                '@typescript-eslint/parser': ['.ts', '.tsx'],
            },
            'import/resolver': {
                'typescript': {
                    'alwaysTryTypes': true,
                    'project': ['./tsconfig.json', './src/*/tsconfig.json']
                },
                'node': {
                    'extensions': ['.js', '.jsx', '.ts', '.tsx']
                }
            }
        },
        files: ['**/*.ts', '**/*.tsx'],  // Explicitly only match TypeScript files
        rules: {
            ...tsPlugin.configs.recommended.rules,
            ...eslintCommentsPlugin.configs.recommended.rules,
            ...functionalPlugin.configs.lite.rules,
            ...prettierConfig.rules,

            'import/extensions': [
                'error',
                'ignorePackages',
                { js: 'always', ts: 'never', tsx: 'never' }
            ],
            'import/no-cycle': [
                'error',
                {
                    maxDepth: 10,
                    ignoreExternal: true,
                    allowUnsafeDynamicCyclicDependency: false
                }
            ],
            'import/no-self-import': 'error',
            'import/no-useless-path-segments': 'error',
            'import/no-duplicates': 'error',
            'functional/no-class-inheritance': 'off',
            'functional/no-mixed-types': 'off',
            'functional/no-classes': 'off',
            'functional/no-return-void': 'off',
            'functional/no-let': 'off',
            'functional/no-loop-statements': 'off',
            'functional/no-throw-statements': 'off',
            'functional/immutable-data': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
            'eslint-comments/disable-enable-pair': [
                'error',
                { allowWholeFile: true }
            ],
            'eslint-comments/no-unused-disable': 'error',
            'import/order': [
                'error',
                { 'newlines-between': 'always', alphabetize: { order: 'asc' } }
            ],
            'sort-imports': [
                'error',
                { ignoreDeclarationSort: true, ignoreCase: true }
            ],
            'monorepo-cop/no-relative-import-outside-package': 'error',
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: ['variable', 'function'],
                    format: ['camelCase'],
                    leadingUnderscore: 'allow',
                },
                {
                    selector: ['variable'],
                    modifiers: ['exported'],
                    format: ['PascalCase', 'camelCase'],
                },
                {
                    selector: 'class',
                    format: ['PascalCase'],
                },
                {
                    selector: ['classMethod'],
                    format: ['camelCase'],
                    leadingUnderscore: 'allow'
                },
                {
                    selector: 'parameter',
                    format: ['camelCase'],
                    leadingUnderscore: 'allow'
                },
                {
                    selector: 'typeLike',
                    format: ['PascalCase']
                }
            ]
        }
    },
    {
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        // Only apply to package index files, excluding test files and non-root index files
        files: ['./src/*/index.ts'],
        rules: {
            '@typescript-eslint/naming-convention': [
                'error',
                {
                    selector: ['variable', 'function'],
                    modifiers: ['exported'],
                    format: ['PascalCase'],
                    prefix: ['Ax']
                },
                {
                    selector: ['class', 'interface', 'typeAlias', 'enum', 'typeParameter'],
                    modifiers: ['exported'],
                    format: ['PascalCase'],
                    prefix: ['Ax']
                }
            ]
        }
    }
];