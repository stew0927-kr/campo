import type { PhotoCatalog, PhotoRow } from '../../contracts.ts';
import { photoCatalogFromRows } from '../../photos/catalog.ts';
import { publicLink } from '../../ui/external.ts';
import { createPublicReader, type ReadConfig } from './remote.ts';
/** campus_photos has no is_published column: SQL 0002 makes its rows publicly readable through RLS. */
export function createPhotoReader(config: ReadConfig, fetcher: typeof fetch = fetch): () => Promise<PhotoCatalog> {
  const read = createPublicReader(config, fetcher);
  return async () => {
    const rows = await read('campus_photos', { campus_id: 'eq.hanyang-seoul', select: 'id,campus_id,node_id,heading_deg,heading_source,direction_hint,hfov_deg,thumb_url,full_url' });
    const valid = rows.filter((value): value is PhotoRow & { campus_id: string } => {
      if (typeof value !== 'object' || value === null) return false;
      const row = value as Record<string, unknown>;
      return row['campus_id'] === 'hanyang-seoul' && typeof row['id'] === 'string' && typeof row['node_id'] === 'string' &&
        typeof row['thumb_url'] === 'string' && publicLink(row['thumb_url']) !== null && typeof row['full_url'] === 'string' && publicLink(row['full_url']) !== null;
    });
    return photoCatalogFromRows(valid);
  };
}
