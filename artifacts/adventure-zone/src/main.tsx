import { createRoot } from 'react-dom/client';

import App from './App';
import { initializeAppearance } from './lib/appearance';

import './index.css';
import './selection-control-fixes.css';
import './call-workspace-flow.css';
import './mobile-compact.css';

initializeAppearance();

document.addEventListener('click', (event) => {
  const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
  const href = link?.getAttribute('href');
  if (!href || href === '#') return;

  const target = document.getElementById(href.slice(1));
  if (!(target instanceof HTMLDetailsElement)) return;

  event.preventDefault();
  target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

createRoot(document.getElementById('root')!).render(<App />);