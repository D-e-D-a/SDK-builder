import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EmbedPage } from './EmbedPage.js';

const root = document.getElementById('root');
if (!root) throw new Error('[Widget] #root element not found');

createRoot(root).render(
  <StrictMode>
    <EmbedPage />
  </StrictMode>
);
