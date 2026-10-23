import type {
  BasemapFile,
  BoundaryFile,
  BuildingsFile,
  GraphFile,
  Manifest,
  Place,
  Relation,
} from './schema.ts';

/** Everything the app needs, loaded and validated by loadCampusData(). */
export interface CampusData {
  manifest: Manifest;
  boundary: BoundaryFile;
  buildings: BuildingsFile;
  basemap: BasemapFile;
  places: Place[];
  relations: Relation[];
  graph: GraphFile;
}
