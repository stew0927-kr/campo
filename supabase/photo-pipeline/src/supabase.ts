// Storage upload and table read/write. Uses the secret-key client from config.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUCKET, TABLE } from './config.ts';
import type { ExistingRow, PlannedPhoto } from './plan.ts';

/** Uploads one WebP file (overwrites if it exists) and returns its public URL. */
export async function uploadWebp(db: SupabaseClient, path: string, body: Buffer): Promise<string> {
  const { error } = await db.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '31536000',
  });
  if (error) throw new Error(`Storage 업로드 실패(${path}): ${error.message}`);
  return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Every row of this campus, 1,000 at a time (the API returns at most 1,000 rows per request). */
export async function existingRows(db: SupabaseClient, campusId: string): Promise<ExistingRow[]> {
  const rows: ExistingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from(TABLE)
      .select('id,node_id,heading_deg,sha256')
      .eq('campus_id', campusId)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`campus_photos 표를 읽지 못했습니다: ${error.message}`);
    rows.push(...((data ?? []) as ExistingRow[]));
    if (!data || data.length < 1000) return rows;
  }
}

export interface PhotoRowInsert extends Omit<PlannedPhoto, 'surveyId' | 'photoPath'> {
  thumb_url: string;
  full_url: string;
  sha256: string;
}

export async function upsertRow(db: SupabaseClient, row: PhotoRowInsert): Promise<void> {
  const { error } = await db.from(TABLE).upsert(row, { onConflict: 'id' });
  if (error) throw new Error(`campus_photos에 저장하지 못했습니다(${row.id}): ${error.message}`);
}
