// 개발용 가상 로드뷰 사진(SVG Data URI). 네트워크 없이도 개발 빌드·테스트에서 바로 보이도록 사진 대신 그림을 만든다.
// 그림마다 실내/실외, 지점 이름, 바라보는 방위가 크게 적혀 있어 어떤 사진이 골라졌는지 한눈에 구분된다.
// React를 import하지 않는 순수 모듈이다. 실제 사진 데이터(data/, Supabase)와 섞지 않는다.
import { normalizeDeg } from '@campo/core';

const COMPASS = ['북쪽', '북동쪽', '동쪽', '남동쪽', '남쪽', '남서쪽', '서쪽', '북서쪽'] as const;

/** 방위 이름(8방위). 0° = 북쪽, 시계 방향. */
export function compassName(deg: number): string {
  return COMPASS[Math.round(normalizeDeg(deg) / 45) % 8]!;
}

/** "북쪽 0°", "동쪽 90°". 화면·그림에 같은 문구를 쓴다. */
export function headingLabel(deg: number | null): string {
  if (deg === null || !Number.isFinite(deg)) return '방향 정보 없음';
  return `${compassName(deg)} ${Math.round(normalizeDeg(deg))}°`;
}

/** 그림의 장면 종류. 지점 성격에 맞춰 가운데 그림을 바꾼다. */
export type DemoScene = 'gate' | 'path' | 'plaza' | 'building' | 'lobby' | 'stairs' | 'elevator' | 'corridor' | 'classroom' | 'restroom';

export interface DemoPhotoSpec {
  /** 지점 이름(예: "가상 본관 앞 갈림길"). */
  place: string;
  indoor: boolean;
  /** 실내면 "2층" 같은 층 표시. */
  levelText?: string | null;
  headingDeg: number;
  scene: DemoScene;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 방위마다 다른 색(북 파랑, 동 초록, 남 주황, 서 보라 …). */
function tint(deg: number): string {
  const hue = Math.round((210 + normalizeDeg(deg)) % 360);
  return `hsl(${hue},62%,46%)`;
}

function sceneShape(scene: DemoScene, w: number, h: number, color: string): string {
  const cx = w / 2;
  const base = h * 0.78;
  switch (scene) {
    case 'gate':
      return `<rect x="${cx - 70}" y="${base - 120}" width="22" height="120" fill="#555"/><rect x="${cx + 48}" y="${base - 120}" width="22" height="120" fill="#555"/><rect x="${cx - 80}" y="${base - 136}" width="160" height="22" rx="4" fill="${color}"/>`;
    case 'plaza':
      return `<ellipse cx="${cx}" cy="${base - 8}" rx="110" ry="22" fill="#9cc3e6"/><rect x="${cx - 6}" y="${base - 70}" width="12" height="62" fill="#7a8a99"/><circle cx="${cx}" cy="${base - 76}" r="16" fill="#bfe1ff"/>`;
    case 'building':
      return `<rect x="${cx - 90}" y="${base - 150}" width="180" height="150" fill="#d9dee5" stroke="#8792a0" stroke-width="3"/>${[0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${cx - 74 + c * 40}" y="${base - 136 + r * 36}" width="26" height="22" fill="${color}" opacity="0.55"/>`).join('')).join('')}<rect x="${cx - 18}" y="${base - 40}" width="36" height="40" fill="#5b6672"/>`;
    case 'lobby':
      return `<rect x="${cx - 100}" y="${base - 60}" width="200" height="16" fill="#8b6b4a"/><rect x="${cx - 90}" y="${base - 44}" width="180" height="44" fill="#a7835d"/><text x="${cx}" y="${base - 72}" font-size="22" text-anchor="middle" fill="#334">안내 데스크</text>`;
    case 'stairs':
      return [0, 1, 2, 3, 4].map((i) => `<rect x="${cx - 80 + i * 14}" y="${base - 24 - i * 24}" width="${160 - i * 28}" height="24" fill="#c9ced6" stroke="#7d8794" stroke-width="2"/>`).join('');
    case 'elevator':
      return `<rect x="${cx - 70}" y="${base - 150}" width="140" height="150" fill="#b8c2cc" stroke="#6d7884" stroke-width="3"/><line x1="${cx}" y1="${base - 150}" x2="${cx}" y2="${base}" stroke="#6d7884" stroke-width="3"/><circle cx="${cx + 92}" cy="${base - 80}" r="10" fill="${color}"/><text x="${cx}" y="${base - 160}" font-size="20" text-anchor="middle" fill="#334">엘리베이터</text>`;
    case 'classroom':
      return `<rect x="${cx - 50}" y="${base - 150}" width="100" height="150" fill="#9b7653" stroke="#5c4632" stroke-width="3"/><circle cx="${cx + 34}" cy="${base - 72}" r="6" fill="#f2d16b"/><rect x="${cx - 36}" y="${base - 182}" width="72" height="26" rx="4" fill="${color}"/><text x="${cx}" y="${base - 163}" font-size="18" text-anchor="middle" fill="white">강의실</text>`;
    case 'restroom':
      return `<rect x="${cx - 60}" y="${base - 150}" width="120" height="150" fill="#cfd8e3" stroke="#6d7884" stroke-width="3"/><circle cx="${cx - 22}" cy="${base - 110}" r="12" fill="#2f6fd6"/><rect x="${cx - 32}" y="${base - 94}" width="20" height="44" fill="#2f6fd6"/><circle cx="${cx + 22}" cy="${base - 110}" r="12" fill="#e2484c"/><polygon points="${cx + 10},${base - 50} ${cx + 34},${base - 50} ${cx + 22},${base - 96}" fill="#e2484c"/>`;
    case 'corridor':
    case 'path':
    default:
      return '';
  }
}

/** 큰 사진(확대·로드뷰용) SVG. */
export function demoPhotoSvg(spec: DemoPhotoSpec, size: 'full' | 'thumb' = 'full'): string {
  const color = tint(spec.headingDeg);
  const heading = headingLabel(spec.headingDeg);
  const where = spec.indoor ? `실내${spec.levelText ? ` · ${spec.levelText}` : ''}` : '실외';
  if (size === 'thumb') {
    const w = 160, h = 120;
    const bg = spec.indoor
      ? `<rect width="${w}" height="${h}" fill="#e9e4da"/><polygon points="0,${h} 50,62 110,62 ${w},${h}" fill="#c9bfae"/>`
      : `<rect width="${w}" height="${h * 0.6}" fill="#bfe0ff"/><rect y="${h * 0.6}" width="${w}" height="${h * 0.4}" fill="#9fc58f"/><polygon points="58,${h} 76,${h * 0.6} 84,${h * 0.6} 102,${h}" fill="#cfc6b8"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}<rect width="${w}" height="30" fill="${color}"/><text x="8" y="21" font-size="16" font-weight="700" fill="white">${esc(heading)}</text><text x="8" y="${h - 10}" font-size="13" font-weight="700" fill="#1d2733">${esc(where)}</text></svg>`;
  }
  const w = 960, h = 640;
  const horizon = h * 0.55;
  const bg = spec.indoor
    ? `<rect width="${w}" height="${h}" fill="#efe9df"/><polygon points="0,0 ${w},0 ${w * 0.62},${horizon - 80} ${w * 0.38},${horizon - 80}" fill="#f8f5ef"/><polygon points="0,${h} ${w * 0.38},${horizon + 40} ${w * 0.62},${horizon + 40} ${w},${h}" fill="#cdbfa9"/><polygon points="0,0 ${w * 0.38},${horizon - 80} ${w * 0.38},${horizon + 40} 0,${h}" fill="#e2d9cb"/><polygon points="${w},0 ${w * 0.62},${horizon - 80} ${w * 0.62},${horizon + 40} ${w},${h}" fill="#d8cebf"/>${[0.2, 0.32, 0.42].map((t) => `<rect x="${w / 2 - 60 * (1 - t)}" y="${(horizon - 80) * t}" width="${120 * (1 - t)}" height="8" fill="#fffbe0"/>`).join('')}`
    : `<rect width="${w}" height="${horizon}" fill="#bfe0ff"/><circle cx="${w * 0.82}" cy="90" r="40" fill="#fff4b8"/><rect y="${horizon}" width="${w}" height="${h - horizon}" fill="#9fc58f"/><polygon points="${w * 0.3},${h} ${w * 0.47},${horizon} ${w * 0.53},${horizon} ${w * 0.7},${h}" fill="#d6cdbf"/>${[0.12, 0.88].map((x) => `<rect x="${w * x - 8}" y="${horizon - 70}" width="16" height="80" fill="#7b5a3c"/><circle cx="${w * x}" cy="${horizon - 90}" r="46" fill="#4f9b55"/>`).join('')}`;
  const shape = sceneShape(spec.scene, w, h, color);
  // 나침반: 위쪽이 사진이 바라보는 방위. 바늘(빨강)은 북쪽을 가리킨다.
  const needle = normalizeDeg(-spec.headingDeg);
  const compass = `<g transform="translate(${w - 90},${h - 100})"><circle r="56" fill="white" stroke="#1d2733" stroke-width="4"/><g transform="rotate(${needle})"><polygon points="0,-46 12,0 -12,0" fill="#e2484c"/><polygon points="0,46 12,0 -12,0" fill="#8b96a3"/><text y="-50" font-size="18" text-anchor="middle" font-weight="800" fill="#e2484c">N</text></g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}${shape}`
    + `<rect width="${w}" height="104" fill="${color}" opacity="0.92"/>`
    + `<text x="28" y="44" font-size="30" font-weight="700" fill="white">${esc(where)} · ${esc(spec.place)}</text>`
    + `<text x="28" y="88" font-size="38" font-weight="900" fill="white">${esc(heading)} 방향</text>`
    + `<text x="28" y="${h - 28}" font-size="24" font-weight="700" fill="#1d2733" opacity="0.7">개발용 가상 로드뷰 · 실제 한양대 사진이 아닙니다</text>`
    + `${compass}</svg>`;
}

/** SVG를 Data URI로(UTF-8 퍼센트 인코딩: 한글이 깨지지 않고 base64 없이 동작한다). */
export const svgDataUri = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const demoPhotoUri = (spec: DemoPhotoSpec, size: 'full' | 'thumb'): string => svgDataUri(demoPhotoSvg(spec, size));
