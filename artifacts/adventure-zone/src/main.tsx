import { createRoot } from 'react-dom/client';

import App from './App';

import './index.css';
import './selection-control-fixes.css';
import './call-workspace-flow.css';

createRoot(document.getElementById('root')!).render(<App />);