/**
 * The admin client's response schemas against the server's own row mappers
 * (server/db/records.ts): if a server record shape changes, this fails before
 * the admin UI silently starts rejecting (or misreading) responses.
 */
import { describe, expect, it } from 'vitest';
import { rowToAudit, rowToLocation, rowToOverride, rowToSuggestion } from '../../../server/db/records.ts';
import {
  QUALITY_WARNING_KINDS,
  auditEventSchema,
  locationRecordSchema,
  overrideRecordSchema,
  overrideViewSchema,
  suggestionRecordSchema,
} from '../../../src/admin/api/schemas.ts';
import type { QualityWarningKind as ServerKind } from '../../../server/domain/overview.ts';

const T = '2026-10-24T09:30:00.000Z';

describe('admin response schemas match the server record mappers', () => {
  it('suggestion rows (all nullable columns null and set)', () => {
    const base = {
      id: 'sug_abcdefghijklmnopqrstuvwxyz',
      status: 'needs_information',
      name: 'Photocopy shop',
      category_id: 'shop',
      lon: 75.7032,
      lat: 31.2533,
      description: null,
      landmark: null,
      evidence_url: null,
      details: null,
      duplicate_of: null,
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      published_location_id: null,
      created_at: T,
      updated_at: T,
      revision: 2,
    };
    expect(suggestionRecordSchema.parse(rowToSuggestion(base))).toEqual(rowToSuggestion(base));
    const full = {
      ...base,
      description: 'Near the gate',
      landmark: 'Gate',
      evidence_url: 'https://example.org/x',
      details: 'd',
      duplicate_of: 'osm:way/1',
      review_note: 'n',
      reviewed_by: 'owner',
      reviewed_at: T,
      published_location_id: 'com:abcdefghijklmnopqrstuvwxyz',
    };
    expect(suggestionRecordSchema.parse(rowToSuggestion(full))).toEqual(rowToSuggestion(full));
  });

  it('location rows', () => {
    const row = {
      id: 'com:abcdefghijklmnopqrstuvwxyz',
      origin: 'community',
      suggestion_id: 'sug_abcdefghijklmnopqrstuvwxyz',
      name: 'Photocopy shop',
      category_id: 'shop',
      lon: 75.7032,
      lat: 31.2533,
      description: null,
      opening_hours: 'Mo-Sa 09:00-18:00',
      wheelchair: 'limited',
      website: null,
      source_url: null,
      verification_status: 'verified',
      last_verified_at: '2026-10-01',
      access_node_id: 42,
      access_note: null,
      status: 'hidden',
      created_by: 'owner',
      created_at: T,
      updated_by: 'owner',
      updated_at: T,
      revision: 3,
    };
    expect(locationRecordSchema.parse(rowToLocation(row))).toEqual(rowToLocation(row));
  });

  it('override rows and the admin override view', () => {
    const row = {
      target_id: 'osm:way/123',
      fields_json: JSON.stringify({ name: 'Block 32', wheelchair: 'yes' }),
      hidden: 1,
      access_node_id: null,
      access_note: null,
      note: 'private',
      base_dataset_version: '2026-10-23',
      updated_by: 'owner',
      updated_at: T,
      revision: 1,
    };
    const rec = rowToOverride(row);
    expect(overrideRecordSchema.parse(rec)).toEqual(rec);
    const view = { ...rec, orphan: true, orphanReason: 'boundary-review', baseName: null };
    expect(overrideViewSchema.parse(view)).toEqual(view);
  });

  it('audit rows, including studio entity types and JSON snapshots', () => {
    const row = {
      id: 9,
      at: T,
      actor: 'owner@example.org',
      action: 'building.publish',
      entity_type: 'building',
      entity_id: 'stu:abcdefghijklmnopqrstuvwxyz',
      before_json: null,
      after_json: JSON.stringify({ version: 1 }),
      outcome: 'success',
      detail: null,
    };
    expect(auditEventSchema.parse(rowToAudit(row))).toEqual(rowToAudit(row));
  });

  it('knows every server quality-warning kind', () => {
    // Compile-time: the client list and the server union are the same set.
    const sameSet: [ServerKind] extends [(typeof QUALITY_WARNING_KINDS)[number]]
      ? [(typeof QUALITY_WARNING_KINDS)[number]] extends [ServerKind]
        ? true
        : false
      : false = true;
    expect(sameSet).toBe(true);
    expect(new Set(QUALITY_WARNING_KINDS).size).toBe(QUALITY_WARNING_KINDS.length);
  });
});
