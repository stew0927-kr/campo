// "현장 기록" under the 상세 정보 tab: what imported field surveys recorded at the selected Feature (photos, the direction
// faced, air pressure, and for an edge the height measured along it). Shown only; none of it is map data.
import { ACCESS_LABELS, ACCESS_PROPS } from '@campo/core';
import { photoUrl, type SurveyNote } from '../model/survey.ts';

const day = (iso: string) => iso.slice(0, 10);
const signed = (n: number, digits: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}`;

export function SurveyNotes({ notes }: { notes: readonly SurveyNote[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="survey-notes" aria-label="현장 기록">
      <h3 className="survey-notes-title">현장 기록</h3>
      {notes.map((n) => (
        <div key={`${n.surveyId}:${n.recordedAt ?? ''}`} className="survey-note" data-survey={n.surveyId}>
          <p className="survey-note-head">{day(n.surveyedAt)} · {n.surveyId}</p>
          {n.recordedAt !== undefined && <p className="survey-note-line survey-note-moved">이 길을 따라 걸으며 남긴 기록입니다({n.recordedAt}).</p>}
          {ACCESS_PROPS.map((key) => n.attachment?.[key] !== undefined && <p key={key} className="survey-note-line">{ACCESS_LABELS[key]} {n.attachment[key]}</p>)}
          {n.vertical && (
            <p className="survey-note-line">
              높이 {signed(n.vertical.height_m, 1)}m (구간의 시작 → 끝, 기압계)
              {n.vertical.grade_pct !== undefined && ` · 경사 ${signed(n.vertical.grade_pct, 1)}%`}
            </p>
          )}
          {n.attachment?.heading_mag_deg !== undefined && <p className="survey-note-line">바라본 방향 {Math.round(n.attachment.heading_mag_deg)}° (자북 기준)</p>}
          {n.attachment?.pressure_hpa !== undefined && <p className="survey-note-line">기압 {n.attachment.pressure_hpa.toFixed(1)} hPa</p>}
          {n.attachment?.note !== undefined && <p className="survey-note-line">{n.attachment.note}</p>}
          {(n.attachment?.photos ?? []).map((path) => (
            <a key={path} className="survey-photo" href={photoUrl(n.surveyId, path)} target="_blank" rel="noreferrer">
              <img src={photoUrl(n.surveyId, path)} alt={`현장 사진 ${path.slice(path.lastIndexOf('/') + 1)}`} loading="lazy" />
            </a>
          ))}
        </div>
      ))}
      <p className="field-help">사진은 저장소에 올리지 않습니다. 불러온 PC의 data/surveys에만 있습니다.</p>
    </section>
  );
}
