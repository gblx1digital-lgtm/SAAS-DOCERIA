import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { StoreProvider } from './lib/store.tsx';
import { FeedbackProvider } from './components/ui.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <FeedbackProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </FeedbackProvider>
    </BrowserRouter>
  </StrictMode>,
);
