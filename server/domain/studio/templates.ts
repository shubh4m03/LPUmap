/**
 * Building Studio template library (S2, §3.3): starter templates are code
 * (src/building-studio/asset-library.ts, never written here); owner
 * templates are D1 variants of a code generator with immutable versions.
 * Creating a version never touches a building — instances store their full
 * model and `templateRef` is provenance only. Retiring hides a template from
 * new placements; its versions stay readable.
 */
import {
  createOwnerTemplateRequestSchema,
  GENERATOR_IDS,
  GENERATORS,
  OWNER_TEMPLATE_ID_RE,
  revisionRequestSchema,
  templateDefinitionSchema,
  updateOwnerTemplateRequestSchema,
  type GeneratorId,
  type OwnerTemplateInput,
  type RenderCost,
  type StudioLibraryResponse,
  type TemplateDefinition,
  type TemplateListing,
} from '../../../src/building-studio/schema.ts';
import { modelFromVariant, renderCostForFaces } from '../../../src/building-studio/asset-library.ts';
import { generateStudioMeshDetailed } from '../../../src/building-studio/mesh/generate.ts';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { auditStmt } from '../../db/audit.ts';
import { changes } from '../../db/sql.ts';
import {
  bumpTemplateVersionStmt,
  getTemplateRow,
  getTemplateVersionRow,
  insertTemplateStmt,
  insertTemplateVersionStmt,
  listTemplateRows,
  setTemplateStatusStmt,
  templateGuard,
  templateVersionNumbers,
  type StudioTemplateRow,
  type TemplateStatus,
} from '../../db/studio-templates.ts';
import type { SqlDatabase } from '../../db/types.ts';
import { fail, notFound, parseOrThrow, unprocessable } from '../../errors.ts';
import { audited } from '../audited.ts';
import { isoNow } from '../context.ts';
import { studioIds, type CodeTemplateLibrary, type StudioContext } from './context.ts';
import { codeLibrary } from './shared.ts';

const libraryOf = (ctx: StudioContext): CodeTemplateLibrary => ctx.library ?? codeLibrary;

// ---------------------------------------------------------------------------
// Render cost (server-assigned for owner templates)
// ---------------------------------------------------------------------------

/**
 * Render cost of the heaviest variant, from the generated meshes (the same
 * bands as the starter library). Each variant's defaults are meshed at the map
 * centre (the face count does not depend on placement). A variant that does
 * not generate is rejected (422): the owner sees why instead of a template
 * that can never be placed.
 */
export function renderCostOf(t: Pick<OwnerTemplateInput, 'variants'>): RenderCost {
  let maxFaces = 0;
  t.variants.forEach((v, i) => {
    const r = generateStudioMeshDetailed(
      modelFromVariant(v, { anchor: [APP_CONFIG.map.center[0], APP_CONFIG.map.center[1]], rotationDeg: 0 }),
    );
    if (!r.ok)
      unprocessable(`definition.variants.${i}.defaults`, `Variant '${v.id}' does not generate: ${r.message}`);
    else maxFaces = Math.max(maxFaces, r.mesh.faces.length);
  });
  return renderCostForFaces(maxFaces);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const codeVersions = (lib: CodeTemplateLibrary, id: string) =>
  lib.templates
    .filter((t) => t.id === id)
    .map((t) => t.version)
    .sort((a, b) => a - b);

/** Any template version (code or owner) by id + version, or null when it does not exist (any more). */
export async function resolveTemplateDefinition(
  db: SqlDatabase,
  ctx: StudioContext,
  ref: { templateId: string; templateVersion: number },
): Promise<TemplateDefinition | null> {
  if (OWNER_TEMPLATE_ID_RE.test(ref.templateId)) {
    const row = await getTemplateVersionRow(db, ref.templateId, ref.templateVersion);
    if (!row) return null;
    const parsed = templateDefinitionSchema.safeParse(row.definition);
    return parsed.success ? parsed.data : null;
  }
  return (
    libraryOf(ctx).templates.find((t) => t.id === ref.templateId && t.version === ref.templateVersion) ?? null
  );
}

async function ownerListing(
  db: SqlDatabase,
  head: StudioTemplateRow,
  versions?: number[],
): Promise<TemplateListing | null> {
  const row = await getTemplateVersionRow(db, head.id, head.latestVersion);
  const parsed = templateDefinitionSchema.safeParse(row?.definition);
  if (!parsed.success) return null;
  return {
    source: 'owner',
    status: head.status,
    definition: parsed.data,
    versions: versions ?? (await templateVersionNumbers(db)).get(head.id) ?? [head.latestVersion],
    revision: head.revision,
  };
}

/** GET /studio/library: starter templates (latest version each), then owner templates by name. */
export async function getStudioLibrary(db: SqlDatabase, ctx: StudioContext): Promise<StudioLibraryResponse> {
  const lib = libraryOf(ctx);
  const latest = new Map<string, TemplateDefinition>();
  for (const t of lib.templates) {
    const cur = latest.get(t.id);
    if (!cur || t.version > cur.version) latest.set(t.id, t);
  }
  const templates: TemplateListing[] = [...latest.values()].map((definition) => ({
    source: 'code',
    status: 'active',
    definition,
    versions: codeVersions(lib, definition.id),
    revision: null,
  }));
  const [heads, versions] = await Promise.all([listTemplateRows(db), templateVersionNumbers(db)]);
  for (const head of heads) {
    // A version this build cannot parse is left out of the listing (it stays in D1, never altered).
    const listing = await ownerListing(db, head, versions.get(head.id));
    if (listing) templates.push(listing);
  }
  return { templates };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * A generator/version this build does not have → 422 'unsupported-model'
 * (checked on the raw body, before the strict schema turns it into a 400).
 */
function assertGeneratorsSupported(raw: unknown): void {
  const def =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).definition : undefined;
  if (typeof def !== 'object' || def === null) return;
  const d = def as Record<string, unknown>;
  const models: unknown[] = [d];
  if (Array.isArray(d.variants))
    for (const v of d.variants)
      if (typeof v === 'object' && v !== null) models.push((v as Record<string, unknown>).defaults);
  for (const m of models) {
    if (typeof m !== 'object' || m === null) continue;
    const { generatorId, generatorVersion } = m as Record<string, unknown>;
    if (typeof generatorId !== 'string' || typeof generatorVersion !== 'number') continue;
    if (!(GENERATOR_IDS as readonly string[]).includes(generatorId))
      fail('unsupported-model', `Unknown generator '${generatorId.slice(0, 64)}'.`);
    if (!GENERATORS[generatorId as GeneratorId].versions.includes(generatorVersion))
      fail('unsupported-model', `Generator '${generatorId}' version ${generatorVersion} is not available.`);
  }
}

function definitionOf(id: string, version: number, input: OwnerTemplateInput): TemplateDefinition {
  const { basedOn: _provenance, ...body } = input;
  return parseOrThrow(
    templateDefinitionSchema,
    { id, version, ...body, renderCost: renderCostOf(input) },
    'Template',
    { prefix: 'definition' },
  );
}

const templateAudit = (
  at: string,
  actor: string,
  action: string,
  id: string,
  before: unknown,
  after: unknown,
  detail?: string,
) => ({
  at,
  actor,
  action,
  entityType: 'template' as const,
  entityId: id,
  before,
  after,
  outcome: 'success' as const,
  detail: detail ?? null,
});

async function loadTemplate(db: SqlDatabase, id: string): Promise<StudioTemplateRow> {
  return (await getTemplateRow(db, id)) ?? notFound('Template', id);
}

async function templateConflict(db: SqlDatabase, id: string): Promise<never> {
  const head = await getTemplateRow(db, id);
  return fail(
    'conflict',
    'This template was changed by someone else since you loaded it. Review the current version and try again.',
    { details: { currentTemplate: head ? await ownerListing(db, head) : null } },
  );
}

/** POST /studio/templates — a new owner template (version 1). */
export async function createOwnerTemplate(
  db: SqlDatabase,
  body: unknown,
  ctx: StudioContext,
): Promise<TemplateListing> {
  return audited(
    db,
    ctx,
    { action: 'template.create', entityType: 'template', entityId: null },
    async (actor) => {
      assertGeneratorsSupported(body);
      const { definition: input } = parseOrThrow(createOwnerTemplateRequestSchema, body, 'Request');
      if (input.basedOn && !(await resolveTemplateDefinition(db, ctx, input.basedOn)))
        fail(
          'not-found',
          `Starter template ${input.basedOn.templateId} v${input.basedOn.templateVersion} does not exist.`,
        );
      const id = studioIds(ctx).next('template');
      const definition = definitionOf(id, 1, input);
      const now = isoNow(ctx);
      const definitionJson = JSON.stringify(definition);
      await db.batch([
        insertTemplateStmt(db, { id, name: definition.name, actor, now }),
        insertTemplateVersionStmt(db, {
          templateId: id,
          version: 1,
          definitionJson,
          generatorId: definition.generatorId,
          generatorVersion: definition.generatorVersion,
          actor,
          now,
        }),
        auditStmt(
          db,
          templateAudit(now, actor, 'template.create', id, null, { definition, basedOn: input.basedOn }),
        ),
      ]);
      return {
        source: 'owner',
        status: 'active',
        definition,
        versions: [1],
        revision: 1,
      };
    },
  );
}

/** PUT /studio/templates/:templateId — a new immutable version; no building changes. */
export async function updateOwnerTemplate(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
): Promise<TemplateListing> {
  return audited(
    db,
    ctx,
    { action: 'template.version', entityType: 'template', entityId: id },
    async (actor) => {
      assertGeneratorsSupported(body);
      const { revision, definition: input } = parseOrThrow(updateOwnerTemplateRequestSchema, body, 'Request');
      const head = await loadTemplate(db, id);
      if (head.revision !== revision) return templateConflict(db, id);
      if (input.basedOn && !(await resolveTemplateDefinition(db, ctx, input.basedOn)))
        fail(
          'not-found',
          `Starter template ${input.basedOn.templateId} v${input.basedOn.templateVersion} does not exist.`,
        );
      const version = head.latestVersion + 1;
      const definition = definitionOf(id, version, input);
      const now = isoNow(ctx);
      const guard = templateGuard(id, revision);
      const [audit, , upd] = await db.batch([
        auditStmt(
          db,
          templateAudit(
            now,
            actor,
            'template.version',
            id,
            { latestVersion: head.latestVersion, name: head.name },
            { definition, basedOn: input.basedOn },
            'New template version; existing buildings keep their stored model.',
          ),
          guard,
        ),
        insertTemplateVersionStmt(
          db,
          {
            templateId: id,
            version,
            definitionJson: JSON.stringify(definition),
            generatorId: definition.generatorId,
            generatorVersion: definition.generatorVersion,
            actor,
            now,
          },
          guard,
        ),
        bumpTemplateVersionStmt(db, id, revision, version, definition.name, actor, now),
      ]);
      if (changes(upd) !== 1 || changes(audit) !== 1) return templateConflict(db, id);
      const listing = await ownerListing(db, {
        ...head,
        latestVersion: version,
        name: definition.name,
        revision: revision + 1,
        updatedBy: actor,
        updatedAt: now,
      });
      return listing ?? fail('internal', 'The new template version could not be read back.');
    },
  );
}

async function setTemplateStatus(
  db: SqlDatabase,
  id: string,
  body: unknown,
  ctx: StudioContext,
  to: TemplateStatus,
): Promise<TemplateListing> {
  const action = to === 'retired' ? 'template.retire' : 'template.unretire';
  return audited(db, ctx, { action, entityType: 'template', entityId: id }, async (actor) => {
    const { revision } = parseOrThrow(revisionRequestSchema, body, 'Request');
    const head = await loadTemplate(db, id);
    if (head.revision !== revision) return templateConflict(db, id);
    if (head.status === to) fail('invalid-transition', `This template is already ${to}.`);
    const now = isoNow(ctx);
    const [audit, upd] = await db.batch([
      auditStmt(db, templateAudit(now, actor, action, id, { status: head.status }, { status: to }), {
        sql: 'EXISTS (SELECT 1 FROM studio_templates WHERE id = ? AND revision = ? AND status <> ?)',
        values: [id, revision, to],
      }),
      setTemplateStatusStmt(db, id, revision, to, actor, now),
    ]);
    if (changes(upd) !== 1 || changes(audit) !== 1) return templateConflict(db, id);
    const listing = await ownerListing(db, {
      ...head,
      status: to,
      revision: revision + 1,
      updatedBy: actor,
      updatedAt: now,
    });
    return listing ?? fail('internal', 'The template could not be read back.');
  });
}

export const retireOwnerTemplate = (db: SqlDatabase, id: string, body: unknown, ctx: StudioContext) =>
  setTemplateStatus(db, id, body, ctx, 'retired');

export const unretireOwnerTemplate = (db: SqlDatabase, id: string, body: unknown, ctx: StudioContext) =>
  setTemplateStatus(db, id, body, ctx, 'active');
