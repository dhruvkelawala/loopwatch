import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'loopwatch-flue-engine',
    target: 'node',
  }),
);

app.route('/', flue());

export default app;
