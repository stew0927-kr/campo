// The shortcut list, opened by ? or the 도움말 button. Names and keys come from the same registry the toolbar is made from.
import { useEffect, useRef } from 'react';
import { shortcutSections } from './registry.ts';

export function HelpDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog ref={ref} className="dialog dialog-help" aria-labelledby="help-title" onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <h2 id="help-title">도구 단축키</h2>
        {shortcutSections().map((section) => (
          <section key={section.title} aria-label={section.title}>
            <h3 className="help-section">{section.title}</h3>
            <dl className="help-list">
              {section.rows.map((row) => (
                <div key={row.label} style={{ display: 'contents' }}>
                  <dt><kbd>{row.keys}</kbd></dt>
                  <dd>{row.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <div className="dialog-actions">
          <button type="submit" className="primary">닫기</button>
        </div>
      </form>
    </dialog>
  );
}
