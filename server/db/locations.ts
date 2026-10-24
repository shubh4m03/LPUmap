/** Locations repository (owner `own:` and approved community `com:` locations). */
import type { SqlDatabase, SqlStatement } from './types.ts';
import { likeContains, stmt } from './sql.ts';
import { rowToLocation, type LocationRecord } from './records.ts';

const INSERT_COLUMNS = `id, origin, suggestion_id, name, category_id, lon, lat, description, opening_hours,
  wheelchair, website, source_url, verification_status, last_verified_at, access_node_id, access_note,
  status, created_by, created_at, updated_by, updated_at, revision`;

function insertValues(l: LocationRecord) {
  return [
    l.id,
    l.origin,
    l.suggestionId,
    l.name,
    l.categoryId,
    l.location[0],
    l.location[1],
    l.description,
    l.openingHours,
    l.wheelchair,
    l.website,
    l.sourceUrl,
    l.verificationStatus,
    l.lastVerifiedAt,
    l.accessNodeId,
    l.accessNote,
    l.status,
    l.createdBy,
    l.createdAt,
    l.updatedBy,
    l.updatedAt,
    l.revision,
  ];
}

const PLACEHOLDERS = Array.from({ length: 22 }, () => '?').join(', ');

export function insertLocationStmt(db: SqlDatabase, l: LocationRecord): SqlStatement {
  return stmt(db, `INSERT INTO locations (${INSERT_COLUMNS}) VALUES (${PLACEHOLDERS})`, ...insertValues(l));
}

/**
 * INSERT that changes nothing (instead of throwing) when the id — or the
 * suggestion link — is already taken, so a concurrent re-creation surfaces as
 * 0 changes → 409 conflict. CHECK violations still throw.
 */
export function insertLocationIfAbsentStmt(db: SqlDatabase, l: LocationRecord): SqlStatement {
  return stmt(
    db,
    `INSERT INTO locations (${INSERT_COLUMNS}) VALUES (${PLACEHOLDERS}) ON CONFLICT DO NOTHING`,
    ...insertValues(l),
  );
}

/** INSERT that happens only if `guard` holds (code-defined SQL + bound values). */
export function insertLocationIfStmt(
  db: SqlDatabase,
  l: LocationRecord,
  guard: { sql: string; values: (string | number | null)[] },
): SqlStatement {
  return stmt(
    db,
    `INSERT INTO locations (${INSERT_COLUMNS}) SELECT ${PLACEHOLDERS} WHERE ${guard.sql}`,
    ...insertValues(l),
    ...guard.values,
  );
}

/**
 * Optimistic full update of every mutable column from `next` (revision is
 * set to `expectedRevision + 1`). Applies only if the row still has
 * `expectedRevision` (and, optionally, `expectedStatus`).
 */
export function updateLocationStmt(
  db: SqlDatabase,
  next: LocationRecord,
  expectedRevision: number,
  expectedStatus?: LocationRecord['status'],
): SqlStatement {
  return stmt(
    db,
    `UPDATE locations SET name = ?, category_id = ?, lon = ?, lat = ?, description = ?, opening_hours = ?,
       wheelchair = ?, website = ?, source_url = ?, verification_status = ?, last_verified_at = ?,
       access_node_id = ?, access_note = ?, status = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ?${expectedStatus ? ' AND status = ?' : ''}`,
    next.name,
    next.categoryId,
    next.location[0],
    next.location[1],
    next.description,
    next.openingHours,
    next.wheelchair,
    next.website,
    next.sourceUrl,
    next.verificationStatus,
    next.lastVerifiedAt,
    next.accessNodeId,
    next.accessNote,
    next.status,
    next.updatedBy,
    next.updatedAt,
    next.id,
    expectedRevision,
    ...(expectedStatus ? [expectedStatus] : []),
  );
}

export function deleteLocationStmt(db: SqlDatabase, id: string, revision: number): SqlStatement {
  return stmt(db, "DELETE FROM locations WHERE id = ? AND revision = ? AND status = 'hidden'", id, revision);
}

export async function getLocationRow(db: SqlDatabase, id: string): Promise<LocationRecord | null> {
  const row = await stmt(db, 'SELECT * FROM locations WHERE id = ?', id).first();
  return row ? rowToLocation(row) : null;
}

/** Every ACTIVE location in id order (the publication input; one statement for a consistent db.batch read). */
export function activeLocationsStmt(db: SqlDatabase): SqlStatement {
  return stmt(db, "SELECT * FROM locations WHERE status = 'active' ORDER BY id LIMIT 5000");
}

export interface LocationFilter {
  status?: string;
  origin?: string;
  q?: string;
}

export async function listLocationRows(
  db: SqlDatabase,
  filter: LocationFilter = {},
): Promise<LocationRecord[]> {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (filter.status) {
    where.push('status = ?');
    binds.push(filter.status);
  }
  if (filter.origin) {
    where.push('origin = ?');
    binds.push(filter.origin);
  }
  const q = filter.q?.trim();
  if (q) {
    const pattern = likeContains(q.slice(0, 120));
    where.push("(name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR id = ?)");
    binds.push(pattern, pattern, q);
  }
  const sql = `SELECT * FROM locations ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id LIMIT 5000`;
  const { results } = await stmt(db, sql, ...binds).all();
  return results.map(rowToLocation);
}

export async function countLocations(db: SqlDatabase) {
  const { results } = await stmt(
    db,
    'SELECT origin, status, COUNT(*) AS n FROM locations GROUP BY origin, status',
  ).all<{
    origin: string;
    status: string;
    n: number;
  }>();
  const out = {
    owner: { active: 0, hidden: 0 },
    community: { active: 0, hidden: 0 },
  };
  for (const r of results) {
    const o = out[r.origin as keyof typeof out];
    if (o && (r.status === 'active' || r.status === 'hidden')) o[r.status] = Number(r.n);
  }
  return out;
}
