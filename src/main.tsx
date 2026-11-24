import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';
import { useDoc } from './store/doc';
import { useUi } from './store/ui';
import { docToSvg } from './export/svg';

// After a new deploy an open tab may ask for a chunk that no longer exists: reload once.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('lc.reloaded')) {
    sessionStorage.setItem('lc.reloaded', '1');
    location.reload();
  }
});

// A small handle for end-to-end tests and for poking at a document from the console.
(window as unknown as { __lc: unknown }).__lc = {
  doc: () => useDoc.getState().doc,
  ui: () => useUi.getState(),
  svg: (options?: Parameters<typeof docToSvg>[1]) => docToSvg(useDoc.getState().doc, options),
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
