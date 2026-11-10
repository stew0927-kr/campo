interface Props {
  nodes: number;
  edges: number;
  dirty: boolean;
  notice: { text: string; tone: 'info' | 'error' } | null;
  hint: string | null;
}

export function StatusBar({ nodes, edges, dirty, notice, hint }: Props) {
  return (
    <footer className="status">
      <span className="status-mode">바깥 모드</span>
      <span>바깥 지점 {nodes}개</span>
      <span>바깥 구간 {edges}개</span>
      <span className={dirty ? 'status-dirty' : 'status-clean'}>{dirty ? '저장하지 않은 변경이 있습니다' : '저장됨'}</span>
      <span className="status-message" role="status" aria-live="polite">
        {notice ? <span className={`notice-${notice.tone}`}>{notice.text}</span> : hint}
      </span>
    </footer>
  );
}
