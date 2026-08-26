import { createRoot } from 'react-dom/client';

import App from './App';
import { initializeAppearance } from './lib/appearance';

import './index.css';
import './appearance-themes.css';
import './selection-control-fixes.css';
import './call-workspace-flow.css';
import './mobile-compact.css';

initializeAppearance();

createRoot(document.getElementById('root')!).render(<App />);