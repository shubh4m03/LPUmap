/**
 * Owner template repository (migration 0002): a mutable head per template
 * (`studio_templates`: name, status, latest_version, revision) and immutable
 * versions (`studio_template_versions`: the TemplateDefinition JSON). A new
 * version never changes any building: instances store their full model.
 */
import type { SqlDatabase, SqlStatement } from './types.ts';
import { parseJsonColumn } from './studio-buildings.ts';
import { stmt } from './sql.ts';

export type TemplateStatus = 'active' | 'retired';

export interface StudioTemplateRow {
  id: string;
  name: string;
  status: TemplateStatus;
  latestVersion: number;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

export interface StudioTemplateVersionRow {
  templateId: string;
  version: number;
  /** Parsed definition_json (unvalidated). */
  definition: unknown;
  generatorId: string;
  generatorVersion: number;
  createdBy: string;
  createdAt: string;
}

type Row = Record<string, unknown>;

function rowToTemplate(r: Row): StudioTemplateRow {
  return {
    id: String(r.id),
    name: String(r.name),
    status: String(r.status) as TemplateStatus,
    latestVersion: Number(r.latest_version),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    updatedBy: String(r.updated_by),
    updatedAt: String(r.updated_at),
    revision: Number(r.revision),
  };
}

function rowToTemplateVersion(r: Row): StudioTemplateVersionRow {
  return {
    templateId: String(r.template_id),
    version: Number(r.version),
    definition: parseJsonColumn(r.definition_json),
    generatorId: String(r.generator_id),
    generatorVersion: Number(r.generator_version),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
  };
}

export interface NewTemplateVersion {
  templateId: string;
  version: number;
  definitionJson: string;
  generatorId: string;
  generatorVersion: number;
  actor: string;
  now: string;
}

export function insertTemplateStmt(
  db: SqlDatabase,
  t: { id: string; name: string; actor: string; now: string },
): SqlStatement {
  return stmt(
    db,
    `INSERT INTO studio_templates (id, name, status, latest_version, created_by, created_at, updated_by, updated_at, revision)
     VALUES (?, ?, 'active', 1, ?, ?, ?, ?, 1)`,
    t.id,
    t.name,
    t.actor,
    t.now,
    t.actor,
    t.now,
  );
}

/** INSERT of an immutable template version; with `guard`, only if the head precondition holds. */
export function insertTemplateVersionStmt(
  db: SqlDatabase,
  v: NewTemplateVersion,
  guard?: { sql: string; values: (string | number)[] },
): SqlStatement {
  const values = [
    v.templateId,
    v.version,
    v.definitionJson,
    v.generatorId,
    v.generatorVersion,
    v.actor,
    v.now,
  ] as const;
  if (!guard)
    return stmt(
      db,
      `INSERT INTO studio_template_versions (template_id, version, definition_json, generator_id, generator_version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ...values,
    );
  return stmt(
    db,
    `INSERT INTO studio_template_versions (template_id, version, definition_json, generator_id, generator_version, created_by, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${guard.sql}`,
    ...values,
    ...guard.values,
  );
}

export const templateGuard = (id: string, revision: number) => ({
  sql: 'EXISTS (SELECT 1 FROM studio_templates WHERE id = ? AND revision = ?)',
  values: [id, revision] as (string | number)[],
});

/** New latest version (+ name) on the head. */
export function bumpTemplateVersionStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  version: number,
  name: string,
  actor: string,
  now: string,
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_templates SET latest_version = ?, name = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ?`,
    version,
    name,
    actor,
    now,
    id,
    expectedRevision,
  );
}

export function setTemplateStatusStmt(
  db: SqlDatabase,
  id: string,
  expectedRevision: number,
  status: TemplateStatus,
  actor: string,
  now: string,
): SqlStatement {
  return stmt(
    db,
    `UPDATE studio_templates SET status = ?, updated_by = ?, updated_at = ?, revision = revision + 1
     WHERE id = ? AND revision = ? AND status <> ?`,
    status,
    actor,
    now,
    id,
    expectedRevision,
    status,
  );
}

export async function getTemplateRow(db: SqlDatabase, id: string): Promise<StudioTemplateRow | null> {
  const row = await stmt(db, 'SELECT * FROM studio_templates WHERE id = ?', id).first();
  return row ? rowToTemplate(row) : null;
}

export async function listTemplateRows(db: SqlDatabase): Promise<StudioTemplateRow[]> {
  const { results } = await stmt(db, 'SELECT * FROM studio_templates ORDER BY name, id LIMIT 1000').all();
  return results.map(rowToTemplate);
}

export async function getTemplateVersionRow(
  db: SqlDatabase,
  id: string,
  version: number,
): Promise<StudioTemplateVersionRow | null> {
  const row = await stmt(
    db,
    'SELECT * FROM studio_template_versions WHERE template_id = ? AND version = ?',
    id,
    version,
  ).first();
  return row ? rowToTemplateVersion(row) : null;
}

/** Version numbers per template (ascending), for the library listing. */
export async function templateVersionNumbers(db: SqlDatabase): Promise<Map<string, number[]>> {
  const { results } = await stmt(
    db,
    'SELECT template_id, version FROM studio_template_versions ORDER BY template_id, version',
  ).all();
  const out = new Map<string, number[]>();
  for (const r of results) {
    const id = String(r.template_id);
    const list = out.get(id) ?? [];
    list.push(Number(r.version));
    out.set(id, list);
  }
  return out;
}
