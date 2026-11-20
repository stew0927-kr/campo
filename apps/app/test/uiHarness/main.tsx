// Test-only DOM adapter. This is not a deployed web app or a native preview.
import { createRoot } from 'react-dom/client';
import App from '../../App.tsx';
createRoot(document.getElementById('root')!).render(<App />);
