import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ExtractPage from './ExtractPage.tsx';
import './index.css';
import { Analytics } from '@vercel/analytics/react';

const isExtractPath =
  window.location.pathname === '/extract' ||
  window.location.pathname === '/extract/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isExtractPath ? <ExtractPage /> : <App />}
    <Analytics />
  </StrictMode>,
);
