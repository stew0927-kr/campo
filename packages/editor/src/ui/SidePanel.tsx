import type { ReactNode } from 'react';
import { PANEL_TABS, type PanelTab } from './registry.ts';

export function SidePanel({ tab, onTab, badges, children }: {
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  badges?: Partial<Record<PanelTab, number>>;
  children: ReactNode;
}) {
  return (
    <aside className="panel">
      <div className="tabs" role="tablist" aria-label="패널">
        {PANEL_TABS.map((t) => {
          const count = badges?.[t.id] ?? 0;
          return (
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
              {count > 0 && <span className="tab-badge" aria-label={t.badgeLabel?.(count)}>{count}</span>}
            </button>
          );
        })}
      </div>
      <div className="panel-body" id="panel-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>{children}</div>
    </aside>
  );
}
