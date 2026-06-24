import { flue } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// The packaged Tauri shell serves the Cockpit UI from a non-HTTP origin, so the
// webview reaches this localhost engine cross-origin. Allow the Tauri webview
// origins; in dev the UI uses the same-origin Vite proxy and needs no CORS.
app.use(
  '*',
  cors({
    origin: ['tauri://localhost', 'http://tauri.localhost'],
  }),
);

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'loopwatch-flue-engine',
    target: 'node',
  }),
);

app.route('/', flue());

export default app;
