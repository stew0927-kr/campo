import { WARNING_CODES, type ValidationIssue, type ValidationResult } from '@campo/core';

const CODE_LABELS: Record<string, string> = {
  schema: '스키마',
  'duplicate-id': 'ID 중복',
  'dangling-ref': '없는 지점',
  'endpoint-mismatch': '선 끝 어긋남',
  'level-not-in-building': '층 목록 밖',
  'vertical-level-mismatch': '층 불일치',
  'ground-level-without-entrance': '출입구 없음',
  'entrance-without-portal': '출입구 연결 없음',
  'isolated-node': '외톨이 지점',
  'disconnected-component': '끊긴 길',
  'needs-check': '현장 확인',
  'no-step-free-route': '계단 없는 길 없음',
};

interface Props {
  result: ValidationResult;
  onLocate: (featureId: string) => void;
}

/** SPEC §7 results from core's validateCampus. Clicking an item moves the map there. */
export function ChecksPanel({ result, onLocate }: Props) {
  const needsCheck = result.warnings.filter((w) => w.code === WARNING_CODES.needsCheck);
  const otherWarnings = result.warnings.filter((w) => w.code !== WARNING_CODES.needsCheck);
  if (result.errors.length === 0 && result.warnings.length === 0) {
    return <p className="panel-empty">오류와 경고가 없습니다.</p>;
  }
  return (
    <div className="checks-panel">
      <Section title="오류" tone="error" issues={result.errors} onLocate={onLocate} empty="오류가 없습니다." />
      <Section title="경고" tone="warning" issues={otherWarnings} onLocate={onLocate} empty="경고가 없습니다." />
      <Section title="현장 확인 필요" tone="survey" issues={needsCheck} onLocate={onLocate} empty="확인할 곳이 없습니다." />
    </div>
  );
}

function Section({ title, tone, issues, onLocate, empty }: {
  title: string;
  tone: 'error' | 'warning' | 'survey';
  issues: ValidationIssue[];
  onLocate: (id: string) => void;
  empty: string;
}) {
  return (
    <section className={`check-section check-${tone}`}>
      <h3>{title} <span className="check-count">{issues.length}</span></h3>
      {issues.length === 0 ? <p className="check-empty">{empty}</p> : (
        <ul>
          {issues.map((i, n) => (
            <li key={`${i.code}-${i.featureId ?? i.file}-${n}`}>
              {i.featureId ? (
                <button type="button" className="check-item" onClick={() => onLocate(i.featureId!)}>
                  <span className="check-code">{CODE_LABELS[i.code] ?? i.code}</span>
                  <span className="check-message">{i.message}</span>
                  <span className="check-where">{i.featureId}</span>
                </button>
              ) : (
                <div className="check-item">
                  <span className="check-code">{CODE_LABELS[i.code] ?? i.code}</span>
                  <span className="check-message">{i.message}</span>
                  <span className="check-where">{i.file}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
