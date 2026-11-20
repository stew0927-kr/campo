// Entry point: npm run upload:photos [-- --dry-run] [--limit=N] [--survey=<id>] [--surveys-dir=<path>] [--verbose]
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { adminClient, ConfigError, REPO_ROOT } from './config.ts';
import { HeicUnsupportedError, makeVariants, sha256Of } from './images.ts';
import { decide, formatMB, parseArgs, planSurvey, storagePaths, type ExistingRow, type PlannedPhoto } from './plan.ts';
import { existingRows, upsertRow, uploadWebp } from './supabase.ts';
import { DEFAULT_SURVEYS_DIR, findSurveys, loadNodeIndex } from './surveys.ts';

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.unknown.length > 0) {
    console.error(`알 수 없는 옵션: ${opts.unknown.join(' ')}`);
    console.error('쓸 수 있는 옵션: --dry-run, --limit=N, --survey=<폴더 이름>, --surveys-dir=<경로>, --verbose');
    return 1;
  }

  const surveysDir = opts.surveysDir ?? DEFAULT_SURVEYS_DIR;
  const surveys = findSurveys(surveysDir, opts.survey);
  if (surveys.length === 0) {
    console.error(`아직 조사 기록이 없습니다. (찾은 위치: ${surveysDir})`);
    console.error("편집기의 '현장 기록 불러오기'로 zip을 먼저 넣거나, 시험할 때는 npm run make-sample 로 샘플을 만든 뒤 --surveys-dir=sample 을 붙여 주세요.");
    return 1;
  }

  // 1) What to upload (no network yet)
  const nodes = loadNodeIndex(opts.campus);
  const planned: PlannedPhoto[] = [];
  const warnings: string[] = [];
  const dirOf = new Map<string, string>();
  for (const s of surveys) {
    dirOf.set(s.id, s.dir);
    const plan = planSurvey(s.json, s.id, nodes, (p) => existsSync(join(s.dir, p)), opts.campus);
    planned.push(...plan.photos);
    warnings.push(...plan.warnings);
  }
  const todo = opts.limit !== null ? planned.slice(0, opts.limit) : planned;
  console.log(`조사 폴더 ${surveys.length}개 · 사진 ${planned.length}장${opts.limit !== null ? ` (이번에 ${todo.length}장만)` : ''}`);
  if (nodes.size === 0) console.log('지도 데이터가 아직 비어 있어 building_id·level은 비워 둡니다(데이터 병합 뒤 다시 실행하면 채워집니다).');
  for (const w of warnings) console.log(`  ! ${w}`);

  // 2) Dry run: convert only, report sizes, touch nothing on the server
  if (opts.dryRun) {
    let full = 0, thumb = 0, failed = 0;
    for (const p of todo) {
      const abs = join(dirOf.get(p.surveyId)!, p.photoPath);
      try {
        const v = await makeVariants(abs);
        full += v.full.length;
        thumb += v.thumb.length;
        if (opts.verbose) console.log(`  ${p.id}  full ${(v.full.length / 1024).toFixed(0)}KB · thumb ${(v.thumb.length / 1024).toFixed(1)}KB`);
      } catch (e) {
        failed++;
        console.log(`  x ${p.photoPath}: ${(e as Error).message}`);
      }
    }
    const n = Math.max(1, todo.length - failed);
    console.log(`[미리보기] 변환 ${todo.length - failed}장 · 실패 ${failed}장 · 예상 용량 full ${formatMB(full)} · thumb ${formatMB(thumb)} (장당 평균 ${(full / n / 1024).toFixed(0)}KB)`);
    console.log('업로드와 표 저장은 하지 않았습니다.');
    return failed > 0 ? 1 : 0;
  }

  // 3) Real run
  const db = adminClient();
  const rows = await existingRows(db, opts.campus);
  const byId = new Map<string, ExistingRow>(rows.map((r) => [r.id, r]));
  const bySha = new Map<string, ExistingRow>(rows.filter((r) => r.sha256).map((r) => [r.sha256!, r]));

  let uploaded = 0, skipped = 0, failed = 0, bytesFull = 0, bytesThumb = 0;
  let heicHinted = false;
  for (const p of todo) {
    const abs = join(dirOf.get(p.surveyId)!, p.photoPath);
    try {
      const sha = sha256Of(readFileSync(abs));
      const d = decide(p, sha, byId, bySha);
      if (d.action === 'skip') {
        skipped++;
        if (d.reason === 'duplicate-elsewhere') console.log(`  ! 같은 사진이 다른 지점/방향으로 이미 있습니다: ${p.id} = ${d.otherId} (사람이 확인해 주세요)`);
        else if (opts.verbose) console.log(`  = ${p.id} (이미 있음)`);
        continue;
      }
      const v = await makeVariants(abs);
      const paths = storagePaths(p.id);
      const thumb_url = await uploadWebp(db, paths.thumb, v.thumb);
      const full_url = await uploadWebp(db, paths.full, v.full);
      const { surveyId: _s, photoPath: _p, ...cols } = p;
      await upsertRow(db, { ...cols, thumb_url, full_url, sha256: sha });
      const row: ExistingRow = { id: p.id, node_id: p.node_id, heading_deg: p.heading_deg, sha256: sha };
      byId.set(p.id, row);
      bySha.set(sha, row);
      uploaded++;
      bytesFull += v.full.length;
      bytesThumb += v.thumb.length;
      if (opts.verbose) console.log(`  + ${p.id} (${d.reason === 'changed' ? '바뀐 사진' : '새 사진'})`);
    } catch (e) {
      failed++;
      if (e instanceof HeicUnsupportedError) {
        if (!heicHinted) console.log(`  x ${e.message}`);
        heicHinted = true;
      } else {
        console.log(`  x ${relative(REPO_ROOT, abs)}: ${(e as Error).message}`);
      }
    }
  }

  console.log('');
  console.log(`새로 올림 ${uploaded}장 · 건너뜀 ${skipped}장 · 실패 ${failed}장`);
  console.log(`올린 용량 full ${formatMB(bytesFull)} · thumb ${formatMB(bytesThumb)}`);
  return failed > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof ConfigError ? e.message : `실행 중 오류: ${(e as Error).message}`);
    process.exit(1);
  },
);
