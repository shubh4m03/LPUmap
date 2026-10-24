import type { AdminNavigate } from '../router.ts';
import type { AdminRoute } from '../routes.ts';

/** Props every admin section component receives (lazy-loaded, mounted only when signed in). */
export interface AdminSectionProps {
  route: AdminRoute;
  navigate: AdminNavigate;
}
