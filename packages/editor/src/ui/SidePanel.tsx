import type { ReactNode } from 'react';
import type { PanelTab } from './ui-state.ts';

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'properties', label: '속성' },
  { id: 'checks', label: '검사' },
  { id: 'routes', label: '길찾기' },
];

export function SidePanel({ tab, onTab, badges, children }: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  badges?: Partial<Record<PanelTab, number>>;
  children: ReactNode;
}) {
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
            {badges?.[t.id] ? <span className="tab-badge" aria-label={`오류 ${badges[t.id]}개`}>{badges[t.id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>{children}</div>
    </aside>
  );
}
