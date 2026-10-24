import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme, LiveRegion } from './accessibility/index.ts';
// Only the lazy boundary and the path test: the owner admin (/admin) is a separate chunk.
import { AdminRoot } from './admin/AdminRoot.tsx';
import { isAdminPath } from './admin/is-admin-path.ts';
import { App } from './app/App.tsx';
import { ToastProvider } from './components/ui/index.ts';
import { validateConfig } from './config/index.ts';
// MapLibre's stylesheet first, so the theme overrides in index.css win even though
// MapLibre itself is loaded lazily in a later chunk.
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/index.css';

validateConfig();
// Before the first render, so the page never flashes the wrong theme.
initTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element in index.html');

createRoot(container).render(
  <StrictMode>
    <ToastProvider>{isAdminPath(window.location.pathname) ? <AdminRoot /> : <App />}</ToastProvider>
    <LiveRegion />
  </StrictMode>,
);
