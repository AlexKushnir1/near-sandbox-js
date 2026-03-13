import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        include: [
            '__tests__/*.test.ts',
            'examples/*.test.ts'
        ],
        exclude: ['node_modules/**', 'dist/**'],
        testTimeout: 120000,
        hookTimeout: 120000, // 2 minutes for setup/teardown hooks
    },
});