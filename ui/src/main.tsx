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
import { createEngineFetch, loadEngineRuntime } from './engine-runtime';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const root = createRoot(document.getElementById('root')!);
const runtime = await loadEngineRuntime();
const client = createFlueClient({
  baseUrl: runtime.flueBaseUrl,
  fetch: createEngineFetch(runtime),
});

root.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <FlueProvider client={client}>
        <App engineRuntime={runtime} />
      </FlueProvider>
    </QueryClientProvider>
  </StrictMode>,
);
