import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Fonte incluída no site (não depende do Google Fonts): só os caracteres latinos usados em português.
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import './index.css';
import App from './App.tsx';
import { StoreProvider } from './lib/store.tsx';
import { FeedbackProvider } from './components/ui.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fullPage>
    <BrowserRouter>
      <FeedbackProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </FeedbackProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
