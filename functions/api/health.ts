/** GET /api/health. */
import { handleHealth } from '../../server/handlers/health.ts';
import { run } from '../../server/handlers/pages.ts';
import type { PagesContext } from '../../server/handlers/pages.ts';

export const onRequest = (context: PagesContext): Promise<Response> => run(handleHealth, context);
