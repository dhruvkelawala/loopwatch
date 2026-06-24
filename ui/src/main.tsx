import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/600.css';
import { FlueProvider } from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// In Vite dev, `/api` is proxied to the local Flue engine to avoid browser CORS.
// In a production build the Tauri shell loads static assets from a non-HTTP
// origin with no dev proxy, so default to the engine's local address instead.
// `VITE_LOOPWATCH_FLUE_URL` overrides either default.
const flueBaseUrl =
  import.meta.env.VITE_LOOPWATCH_FLUE_URL ??
  (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:3583');
const client = createFlueClient({
  baseUrl: flueBaseUrl,
  fetch: (input, init) => fetch(input, init),
});
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FlueProvider client={client}>
        <App flueBaseUrl={flueBaseUrl} />
      </FlueProvider>
    </QueryClientProvider>
  </StrictMode>,
);
