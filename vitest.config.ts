import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The viz-engine dist emits extension-less deep imports (lodash-es/clamp) that Node's
    // ESM resolver rejects. Inlining routes them through Vite's resolver instead.
    server: { deps: { inline: [/@graphysdk/] } },
  },
  resolve: {
    alias: { '@': new URL('.', import.meta.url).pathname },
  },
});
