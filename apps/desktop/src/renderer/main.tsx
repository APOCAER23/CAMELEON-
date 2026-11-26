import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { apply, stored } from './theme';
import { App } from './App';
import { applyDensity, storedDensity } from './pages/Settings';

apply(stored()); // before first paint: no theme flash
applyDensity(storedDensity());
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
