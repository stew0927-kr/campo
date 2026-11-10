import type { PanelTab } from './ui-state.ts';

const TABS: { id: PanelTab; label: string; empty: string }[] = [
  { id: 'properties', label: '속성', empty: '지점이나 구간을 고르면 여기에서 속성을 고칠 수 있습니다.' },
  { id: 'checks', label: '검사', empty: '데이터 검사 결과가 여기에 나옵니다.' },
  { id: 'routes', label: '길찾기', empty: '출발지와 도착지를 고르면 두 가지 경로를 보여 드립니다.' },
];

export function SidePanel({ tab, onTab }: { tab: PanelTab; onTab: (tab: PanelTab) => void }) {
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <aside className="panel">
      <div className="tabs" role="tablist" aria-label="패널">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === tab}
            aria-controls="panel-body"
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <p className="panel-empty">{current.empty}</p>
      </div>
    </aside>
  );
}
