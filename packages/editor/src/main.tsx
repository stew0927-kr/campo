import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <p>캠포 편집기를 준비하고 있습니다.</p>
  </StrictMode>,
);
