import { describe, expect, it, vi } from 'vitest';
import {
  DATA_SCHEMA_VERSION,
  DatasetError,
  defaultDataBaseUrl,
  loadCampusData,
} from '../../../src/data/index.ts';

const fc = { type: 'FeatureCollection', features: [] };
const manifest = {
  schemaVersion: DATA_SCHEMA_VERSION,
  datasetVersion: 'abc123def456',
  builtFrom: '2026-10-23T09:39:00Z',
  sources: [{ id: 'osm', name: 'OpenStreetMap' }],
  files: {},
  counts: { places: 1 },
  bbox: [75.69, 31.24, 75.71, 31.26],
};
const place = {
  id: 'osm:way/1',
  name: null,
  displayName: 'Unnamed building',
  aliases: [],
  categoryId: 'building',
  kind: 'building',
  location: [75.7, 31.25],
  campusZone: 'on-campus',
  wheelchair: 'unknown',
  provenance: { sourceId: 'osm', verificationStatus: 'imported' },
};
const files: Record<string, unknown> = {
  'manifest.json': manifest,
  'boundary.geojson': fc,
  'buildings.geojson': fc,
  'basemap.geojson': fc,
  'places.json': { schemaVersion: DATA_SCHEMA_VERSION, places: [place] },
  'relations.json': { schemaVersion: DATA_SCHEMA_VERSION, relations: [] },
  'graph.json': { schemaVersion: DATA_SCHEMA_VERSION, nodes: [[75.7, 31.25]], edges: [] },
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  } as Response;
}

function mockFetch(overrides: Record<string, unknown | Error | { status: number }> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const file = url.replace(/^.*\//, '').replace(/\?.*$/, '');
    const o = overrides[file];
    if (o instanceof Error) throw o;
    if (o && typeof o === 'object' && 'status' in o) return response({}, (o as { status: number }).status);
    if (file in overrides) return response(o);
    if (!(file in files)) return response({}, 404);
    return response(files[file]);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('loadCampusData', () => {
  it('loads every file, manifest first, with a cache-busting version on data files', async () => {
    const fetchImpl = mockFetch();
    const data = await loadCampusData({ baseUrl: '/base/data', fetchImpl });
    expect(data.places).toHaveLength(1);
    expect(data.places[0]!.id).toBe('osm:way/1');
    expect(data.manifest.datasetVersion).toBe('abc123def456');
    expect(data.graph.nodes).toEqual([[75.7, 31.25]]);
    const urls = fetchImpl.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(urls[0]).toBe('/base/data/manifest.json');
    expect(urls.slice(1).sort()).toEqual(
      [
        'basemap.geojson',
        'boundary.geojson',
        'buildings.geojson',
        'graph.json',
        'places.json',
        'relations.json',
      ]
        .map((f) => `/base/data/${f}?v=abc123def456`)
        .sort(),
    );
  });

  it('rejects a schema-version mismatch before fetching anything else', async () => {
    const fetchImpl = mockFetch({ 'manifest.json': { ...manifest, schemaVersion: DATA_SCHEMA_VERSION + 1 } });
    const err = await loadCampusData({ baseUrl: '/d/', fetchImpl }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatasetError);
    expect(err).toMatchObject({ code: 'schema-version', file: 'manifest.json' });
    expect((err as Error).message).toMatch(
      new RegExp(`schema version ${DATA_SCHEMA_VERSION + 1}.*expects version ${DATA_SCHEMA_VERSION}`),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats a manifest without a numeric schemaVersion as invalid, not as a version mismatch', async () => {
    for (const body of [{ ...manifest, schemaVersion: undefined }, '"<!doctype html>"', 'null']) {
      const fetchImpl = mockFetch({ 'manifest.json': body });
      await expect(loadCampusData({ baseUrl: '/d/', fetchImpl })).rejects.toMatchObject({
        code: 'invalid',
        file: 'manifest.json',
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('names the file that fails validation', async () => {
    const fetchImpl = mockFetch({
      'places.json': { schemaVersion: DATA_SCHEMA_VERSION, places: [{ ...place, displayName: '' }] },
    });
    const err = await loadCampusData({ baseUrl: '/d/', fetchImpl }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'invalid', file: 'places.json' });
    expect((err as Error).message).toMatch(/places\.json failed validation at places\.0\.displayName/);
  });

  it('reports malformed JSON as invalid', async () => {
    const fetchImpl = mockFetch({ 'graph.json': '{"nodes": [' });
    await expect(loadCampusData({ baseUrl: '/d/', fetchImpl })).rejects.toMatchObject({
      code: 'invalid',
      file: 'graph.json',
    });
  });

  it('maps fetch failures and HTTP errors to network errors', async () => {
    await expect(
      loadCampusData({
        baseUrl: '/d/',
        fetchImpl: mockFetch({ 'manifest.json': new TypeError('Failed to fetch') }),
      }),
    ).rejects.toMatchObject({ code: 'network', file: 'manifest.json' });
    const err = await loadCampusData({
      baseUrl: '/d/',
      fetchImpl: mockFetch({ 'buildings.geojson': { status: 503 } }),
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'network', file: 'buildings.geojson' });
    expect((err as Error).message).toMatch(/HTTP 503/);
  });

  it('defaults to the Vite base URL', () => {
    expect(defaultDataBaseUrl()).toBe(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}data/`);
  });
});
