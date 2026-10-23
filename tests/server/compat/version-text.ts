/**
 * Version constants parsed from SOURCE TEXT, so the same parser works on any
 * commit (`git show <rev>:<path>`) and on a reverted clone without importing
 * that commit's modules.
 */
export const schemaVersionIn = (schemaTs: string): number | null => {
  const m = /export const DATA_SCHEMA_VERSION = (\d+);/.exec(schemaTs);
  return m ? Number(m[1]) : null;
};

export const dataCacheIn = (configTs: string): string | null =>
  /dataCache: '([^']+)'/.exec(configTs)?.[1] ?? null;

export const publicationVersionIn = (communitySchemaTs: string): number | null => {
  const m = /export const PUBLICATION_SCHEMA_VERSION = (\d+);/.exec(communitySchemaTs);
  return m ? Number(m[1]) : null;
};
