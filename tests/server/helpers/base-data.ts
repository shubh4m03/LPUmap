/**
 * BaseData builders for server tests: the synthetic campus (fast, fully
 * controlled) and the REAL generated dataset in public/data, loaded through
 * the production loader (loadBaseData) with a file-system fetcher.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildBaseData, clearBaseDataCache, loadBaseData, type BaseData } from '../../../server/base-data.ts';
import type { Place } from '../../../src/data/schema.ts';
import { BOUNDARY, DATASET_VERSION, GRAPH, PLACES } from '../../unit/community/synthetic-campus.ts';
import { REPO_ROOT } from './test-db.ts';

export * from '../../unit/community/synthetic-campus.ts';

export interface FakeBaseOptions {
  datasetVersion?: string;
  places?: Place[];
  /** Replace the graph edges' foot flags, e.g. to simulate a rebuild that changed walkability. */
  footEdges?: boolean[];
}

export function fakeBaseData(opts: FakeBaseOptions = {}): BaseData {
  const graph = opts.footEdges
    ? { ...GRAPH, edges: GRAPH.edges.map((e, i) => ({ ...e, foot: opts.footEdges?.[i] ?? e.foot })) }
    : GRAPH;
  return buildBaseData({
    datasetVersion: opts.datasetVersion ?? DATASET_VERSION,
    places: opts.places ?? PLACES,
    graph,
    boundary: BOUNDARY,
  });
}

/** Fetcher serving files from public/ like the Pages ASSETS binding. */
export const diskAssets = async (path: string): Promise<Response> => {
  try {
    const body = await readFile(join(REPO_ROOT, 'public', path.replace(/^\/+/, '')));
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
};

export async function realBaseData(): Promise<BaseData> {
  clearBaseDataCache();
  return loadBaseData(diskAssets);
}
