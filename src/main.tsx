import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';

// After a new deploy an open tab may ask for a chunk that no longer exists: reload once.
window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('lc.reloaded')) {
    sessionStorage.setItem('lc.reloaded', '1');
    location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
