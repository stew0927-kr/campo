// Sign-in gate + three tabs. Only users whose profiles.role is 'admin' get past the gate;
// the database checks the same thing again on every write (RLS), so hiding the screens is not the security.
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { FestivalPage } from './components/FestivalPage.tsx';
import { ResourcePanel } from './components/ResourcePanel.tsx';
import { koreanError } from './lib/convert.ts';
import { configProblem, supabase } from './lib/supabase.ts';
import { essaySessions, schoolEvents } from './tables.ts';

type Tab = 'essay' | 'festival' | 'events';
type Role = 'checking' | 'admin' | 'not-admin';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<Role>('checking');
  const [tab, setTab] = useState<Tab>('essay');

  useEffect(() => {
    if (configProblem) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setRole('checking');
    void supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setRole((data as { role?: string } | null)?.role === 'admin' ? 'admin' : 'not-admin'));
  }, [session]);

  if (configProblem) return <Centered title="설정이 필요합니다">{configProblem}</Centered>;
  if (!ready) return <Centered title="캠포 관리자">불러오는 중…</Centered>;
  if (!session) return <Login />;
  if (role === 'checking') return <Centered title="캠포 관리자">권한을 확인하는 중…</Centered>;
  if (role === 'not-admin') {
    return (
      <Centered title="관리자 권한이 없습니다">
        <p>{session.user.email} 계정은 관리자로 등록되어 있지 않습니다.</p>
        <button onClick={() => void supabase.auth.signOut()}>로그아웃</button>
      </Centered>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>캠포 관리자</h1>
        <nav>
          {([['essay', '논술'], ['festival', '축제'], ['events', '학교행사']] as const).map(([k, label]) => (
            <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="who">
          {session.user.email}
          <button onClick={() => void supabase.auth.signOut()}>로그아웃</button>
        </div>
      </header>
      <main>
        <p className="hint">“앱에 공개”를 켠 항목만 앱에 보입니다. 숨김 상태로 저장해 두고, 준비가 되면 공개로 바꾸세요.</p>
        {tab === 'essay' && <ResourcePanel config={essaySessions} />}
        {tab === 'festival' && <FestivalPage />}
        {tab === 'events' && <ResourcePanel config={schoolEvents} />}
      </main>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <Centered title="캠포 관리자 로그인">
      <form
        className="login"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
          setBusy(false);
          if (err) setError(koreanError(err));
        }}
      >
        <label>
          <span>이메일</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          <span>비밀번호</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="status error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>{busy ? '로그인 중…' : '로그인'}</button>
      </form>
    </Centered>
  );
}

function Centered({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="centered">
      <div className="card">
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}
