// Removes the test photos made by make-sample: rows whose node_id starts with "sample-node-" and their two files.
//   npm run clean-sample
import { adminClient, BUCKET, ConfigError, TABLE } from './config.ts';
import { storagePaths } from './plan.ts';

const PREFIX = 'sample-node-';

async function main(): Promise<number> {
  const db = adminClient();
  const { data, error } = await db.from(TABLE).select('id').like('node_id', `${PREFIX}%`);
  if (error) throw new Error(`표를 읽지 못했습니다: ${error.message}`);
  const ids = (data ?? []).map((r) => (r as { id: string }).id);
  if (ids.length === 0) {
    console.log('지울 샘플 사진이 없습니다.');
    return 0;
  }
  const files = ids.flatMap((id) => Object.values(storagePaths(id)));
  const rm = await db.storage.from(BUCKET).remove(files);
  if (rm.error) throw new Error(`Storage 파일을 지우지 못했습니다: ${rm.error.message}`);
  const del = await db.from(TABLE).delete().like('node_id', `${PREFIX}%`);
  if (del.error) throw new Error(`표에서 지우지 못했습니다: ${del.error.message}`);
  console.log(`샘플 사진 ${ids.length}장(파일 ${files.length}개)과 표의 ${ids.length}줄을 지웠습니다.`);
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e instanceof ConfigError ? e.message : (e as Error).message); process.exit(1); });
