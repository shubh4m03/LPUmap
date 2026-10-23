/** /api/admin/** — every method goes to the admin router (auth enforced there). */
import { handleAdmin } from '../../../server/handlers/admin/index.ts';
import { run } from '../../../server/handlers/pages.ts';
import type { PagesContext } from '../../../server/handlers/pages.ts';

export const onRequest = (context: PagesContext): Promise<Response> => run(handleAdmin, context);
