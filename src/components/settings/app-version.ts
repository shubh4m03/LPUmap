// Named JSON import: Vite tree-shakes it to this one field, so nothing else from
// package.json ends up in the bundle.
import { version } from '../../../package.json';

/** The app's own version (package.json), distinct from the dataset version. */
export const APP_VERSION: string = version;
