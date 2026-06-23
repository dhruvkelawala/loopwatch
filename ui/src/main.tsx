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
// The later Tauri shell can pass an absolute local URL via VITE_LOOPWATCH_FLUE_URL.
const flueBaseUrl = import.meta.env.VITE_LOOPWATCH_FLUE_URL ?? '/api';
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
