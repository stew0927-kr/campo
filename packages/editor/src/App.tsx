// Loads the campus folder into an edit session, then hands it to the editor screen (app/Workspace.tsx).
import { useEffect, useState } from 'react';
import { fetchCampusFiles } from './api.ts';
import { Workspace } from './app/Workspace.tsx';
import { createSession, type Session } from './model/session.ts';

// ?campus=<id> opens another campus folder (the e2e tests do); otherwise VITE_CAMPUS_ID, else hanyang-seoul.
const CAMPUS_ID = new URLSearchParams(window.location.search).get('campus')?.trim() || import.meta.env.VITE_CAMPUS_ID?.trim() || 'hanyang-seoul';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Development runs this effect twice (StrictMode): only the last load becomes the session. Two sessions would leave
    // the screen showing one's state while edits go to the other's history (the first edit then looks like a change of everything).
    let current = true;
    fetchCampusFiles(CAMPUS_ID)
      .then((files) => current && setSession(createSession(CAMPUS_ID, files)))
      .catch((err: Error) => current && setLoadError(err.message));
    return () => {
      current = false;
    };
  }, []);

  if (loadError) return <p className="load-message notice-error">캠퍼스 데이터를 불러오지 못했습니다. {loadError}</p>;
  if (!session) return <p className="load-message">캠퍼스 데이터를 불러오는 중입니다…</p>;
  return <Workspace session={session} />;
}
