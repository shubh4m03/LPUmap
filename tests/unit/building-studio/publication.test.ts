/** Publication v2 (GET /api/locations): v1 fields unchanged, `buildings` added, v1 bodies still readable. */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PUBLICATION,
  PUBLICATION_SCHEMA_VERSION,
  publicationSchema,
  SUPPORTED_PUBLICATION_SCHEMA_VERSIONS,
} from '../../../src/community/schema.ts';
import { published, STU_ID } from './fixtures.ts';

const v1Body = {
  schemaVersion: 1,
  publicationVersion: 12,
  generatedAt: '2026-10-20T10:00:00.000Z',
  locations: [],
  overrides: [
    {
      targetId: 'osm:way/1',
      hidden: false,
      fields: { name: 'Block X' },
      accessNodeId: null,
      revision: 1,
      updatedAt: '2026-10-20T10:00:00.000Z',
    },
  ],
};

describe('publication v2', () => {
  it('is version 2 and still reads version 1 (server rollback keeps feeding current clients)', () => {
    expect(PUBLICATION_SCHEMA_VERSION).toBe(2);
    expect(SUPPORTED_PUBLICATION_SCHEMA_VERSIONS).toEqual([1, 2]);
    const v1 = publicationSchema.parse(v1Body);
    expect(v1.buildings).toBeUndefined();
    expect(v1.overrides).toHaveLength(1);
  });

  it('carries published studio buildings and nothing private', () => {
    const body = {
      ...v1Body,
      schemaVersion: 2,
      buildings: [
        {
          ...published(),
          identity: { ...published().identity, notes: 'secret' },
          draft: {},
          updatedBy: 'owner',
        },
      ],
    };
    const pub = publicationSchema.parse(body);
    expect(pub.buildings).toHaveLength(1);
    const b = pub.buildings![0]!;
    expect(b.id).toBe(STU_ID);
    expect(b).not.toHaveProperty('draft');
    expect(b).not.toHaveProperty('updatedBy');
    expect(b.identity).not.toHaveProperty('notes');
  });

  it('rejects an unknown schema version and malformed buildings', () => {
    expect(publicationSchema.safeParse({ ...v1Body, schemaVersion: 3 }).success).toBe(false);
    expect(
      publicationSchema.safeParse({ ...v1Body, schemaVersion: 2, buildings: [{ id: 'nope' }] }).success,
    ).toBe(false);
  });

  it('EMPTY_PUBLICATION is a valid v2 body with no buildings', () => {
    expect(publicationSchema.parse(EMPTY_PUBLICATION)).toEqual(EMPTY_PUBLICATION);
    expect(EMPTY_PUBLICATION.buildings).toEqual([]);
  });
});
