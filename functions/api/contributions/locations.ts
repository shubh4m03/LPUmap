/** POST /api/contributions/locations — thin adapter; every other method → 405 from the handler. */
import { handleContribution } from '../../../server/handlers/contributions.ts';
import { run } from '../../../server/handlers/pages.ts';
import type { PagesContext } from '../../../server/handlers/pages.ts';

export const onRequest = (context: PagesContext): Promise<Response> => run(handleContribution, context);
