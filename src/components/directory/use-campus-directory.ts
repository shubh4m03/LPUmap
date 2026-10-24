import { useAtlas } from '../../app/data/atlas-context.ts';
import type { CampusData } from '../../data/index.ts';
import { createDirectory, type CampusDirectory } from '../../directory/index.ts';

// One directory per loaded dataset, shared by the panel, the peek and every view mode.
const cache = new WeakMap<CampusData, CampusDirectory>();

/** The directory of a dataset with nothing excluded (tests and tools; the app uses useCampusDirectory). */
export function campusDirectoryFor(data: CampusData): CampusDirectory {
  let dir = cache.get(data);
  if (!dir) {
    dir = createDirectory({ buildings: data.buildings, places: data.places, relations: data.relations });
    cache.set(data, dir);
  }
  return dir;
}

/**
 * The building directory of the loaded dataset (derived once in the app
 * services, with the owner's publication applied and the studio buildings
 * hidden from the directory left out).
 */
export function useCampusDirectory(): CampusDirectory {
  return useAtlas().buildingDirectory;
}
