// Makes a small test survey without the field survey app:  npm run make-sample [-- <folder with your photos>]
// With a folder: copies up to 3 photos (jpg/jpeg/png/heic) from it. Without: draws 3 test pictures.
// Output: sample/sv-20261120-sample/{survey.json, photos/} (sample/ is in .gitignore, never committed).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { PIPELINE_ROOT } from './config.ts';

export const SAMPLE_NODE_PREFIX = 'sample-node-';
const SURVEY_ID = 'sv-20261120-sample';
const HEADINGS = [0, 90, 180];

async function drawPicture(path: string, n: number): Promise<void> {
  const hue = [205, 150, 30][n - 1] ?? 260;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200">
    <rect width="1600" height="1200" fill="hsl(${hue},45%,70%)"/>
    <polygon points="0,1200 1600,1200 1100,600 500,600" fill="hsl(${hue},30%,55%)"/>
    <text x="800" y="420" font-size="120" text-anchor="middle" font-family="sans-serif" fill="#111">CAMPO TEST ${n}</text>
    <text x="800" y="560" font-size="64" text-anchor="middle" font-family="sans-serif" fill="#111">heading ${HEADINGS[n - 1]}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toFile(path);
}

async function main(): Promise<number> {
  const source = process.argv[2] ? resolve(process.argv[2]) : null;
  const root = join(PIPELINE_ROOT, 'sample', SURVEY_ID);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'photos'), { recursive: true });

  const files: string[] = [];
  if (source !== null) {
    if (!existsSync(source)) {
      console.error(`폴더를 찾을 수 없습니다: ${source}`);
      return 1;
    }
    const picks = readdirSync(source).filter((f) => /\.(jpe?g|png|heic)$/i.test(f)).sort().slice(0, 3);
    if (picks.length === 0) {
      console.error('그 폴더에 jpg·png·heic 사진이 없습니다.');
      return 1;
    }
    picks.forEach((f, i) => {
      const name = `photos/sample-${i + 1}${extname(f).toLowerCase()}`;
      copyFileSync(join(source, f), join(root, name));
      files.push(name);
    });
  } else {
    for (let n = 1; n <= 3; n++) {
      const name = `photos/sample-${n}.jpg`;
      await drawPicture(join(root, name), n);
      files.push(name);
    }
  }

  const attachments: Record<string, unknown> = {};
  files.forEach((name, i) => {
    attachments[`${SAMPLE_NODE_PREFIX}${i + 1}`] = {
      recorded_at: '2026-11-20T10:00:00+09:00',
      photos: [name],
      photo_meta: { [name]: { heading_deg: HEADINGS[i] ?? 0, heading_source: 'manual', direction_hint: '시연용 사진입니다' } },
    };
  });
  const survey = {
    format: 'campo-survey',
    version: 1,
    id: SURVEY_ID,
    campus: 'hanyang-seoul',
    surveyed_at: '2026-11-20T10:00:00+09:00',
    attachments,
    vertical: [],
  };
  writeFileSync(join(root, 'survey.json'), JSON.stringify(survey, null, 2) + '\n');
  console.log(`샘플 조사 폴더를 만들었습니다: sample/${SURVEY_ID} (사진 ${files.length}장${source ? ', 내 사진' : ', 시험용 그림'})`);
  console.log('다음: npm run upload:photos -- --surveys-dir=sample --dry-run');
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error((e as Error).message); process.exit(1); });
