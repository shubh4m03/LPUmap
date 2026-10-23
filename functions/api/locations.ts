/** GET /api/locations — published community/owner layer. */
import { handlePublication } from '../../server/handlers/publication.ts';
import { run } from '../../server/handlers/pages.ts';
import type { PagesContext } from '../../server/handlers/pages.ts';

export const onRequest = (context: PagesContext): Promise<Response> => run(handlePublication, context);
