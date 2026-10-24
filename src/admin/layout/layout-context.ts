import { createContext, useContext } from 'react';

export interface AdminLayoutApi {
  /** The aside slot element (portal target), once mounted. */
  asideElement: HTMLElement | null;
  /** Marks the aside as used while the returned cleanup has not run. */
  registerAside(): () => void;
  navCollapsed: boolean;
  setNavCollapsed(collapsed: boolean): void;
}

export const AdminLayoutContext = createContext<AdminLayoutApi | null>(null);

export function useAdminLayout(): AdminLayoutApi {
  const v = useContext(AdminLayoutContext);
  if (!v) throw new Error('useAdminLayout must be used inside <AdminLayout>');
  return v;
}
