import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAdminLayout } from './layout-context.ts';

/**
 * Renders `children` into the layout's aside slot (e.g. a record's details
 * next to a list). The aside is shown only while at least one <AdminAside>
 * is mounted.
 */
export function AdminAside({ children }: { children: ReactNode }) {
  const { asideElement, registerAside } = useAdminLayout();
  useEffect(() => registerAside(), [registerAside]);
  return asideElement ? createPortal(children, asideElement) : null;
}
