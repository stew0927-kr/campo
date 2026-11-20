// Lets the top tabs know whether any add/edit form is open, so going back to a tab's first screen
// can ask before throwing away what was typed.
import { createContext } from 'react';

export interface EditingTracker {
  report: (panelId: string, open: boolean) => void;
}

export const EditingContext = createContext<EditingTracker>({ report: () => {} });
