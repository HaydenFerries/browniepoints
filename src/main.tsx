import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import '@fontsource-variable/nunito';
import './styles.css';
import App from './app/App';
import { captureInviteFromUrl } from './app/invite';

captureInviteFromUrl();
// An invite link opened in an already-open tab only changes the fragment.
window.addEventListener('hashchange', () => {
  if (location.hash.includes('join=')) location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
