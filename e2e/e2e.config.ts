import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';
import { chatgpt } from 'e2e/oauth/chatgpt';

export default {
  tests: 'tests/*.e2e.ts',
  workers: 1,
  agents: { default: { model: chatgpt('gpt-6-luna') } },
  targets: [
    {
      name: 'chromium',
      engine: web({ browser: 'chromium' }),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: process.execPath,
          args: ['start-studio.mjs', '{port}'],
          log: '.e2e/logs/studio.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
