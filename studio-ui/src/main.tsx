import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setNonce } from 'get-nonce';
import { App } from './App';
import './index.css';
import { cspNonce } from '@/components/code-style';
import { adoptToken } from '@/lib/session';
import { applyTheme, readTheme } from '@/lib/theme';

setNonce(cspNonce());
adoptToken();
applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
