import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import { App } from './App';
import './index.css';
import { cspNonce } from '@/components/code-style';
import { adoptToken } from '@/lib/session';

setNonce(cspNonce());
adoptToken();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
