import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.spec.ts'],
    exclude: ['src/app/app.component.spec.ts', 'src/app/home/**/*.spec.ts'],
    setupFiles: ['./src/test-setup.ts'],
  },
});
