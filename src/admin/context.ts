/**
 * React access to the admin API and session (one instance per AdminApp).
 * Sections read them with `useAdminApi()` / `useAdminSession()`; both throw
 * outside <AdminProvider>, so a section can never call the API unauthenticated
 * by accident (AdminApp mounts sections only in the `signed-in` state).
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import { createAdminApi, type AdminApi, type AdminApiOptions } from './api/index.ts';
import {
  createAdminSessionClient,
  type AdminSessionClient,
  type AdminSessionState,
  type SessionClientOptions,
} from './session/session-client.ts';

export interface AdminServices {
  api: AdminApi;
  session: AdminSessionClient;
}

export const AdminContext = createContext<AdminServices | null>(null);

/** Builds the API client and the session client wired together (401 on any request → sessionEnded). */
export function createAdminServices(
  opts: Omit<AdminApiOptions, 'onUnauthenticated'> & SessionClientOptions = {},
): AdminServices {
  // `session` is assigned before any request can complete, so the callback always sees it.
  let session: AdminSessionClient | null = null;
  const api = createAdminApi({ ...opts, onUnauthenticated: () => session?.sessionEnded() });
  session = createAdminSessionClient(api, opts);
  return { api, session };
}

function useServices(): AdminServices {
  const s = useContext(AdminContext);
  if (!s) throw new Error('Admin hooks must be used inside <AdminProvider>');
  return s;
}

export const useAdminApi = (): AdminApi => useServices().api;
export const useAdminSessionClient = (): AdminSessionClient => useServices().session;

/** The current session state; re-renders on every transition. */
export function useAdminSession(): AdminSessionState {
  const { session } = useServices();
  return useSyncExternalStore(session.subscribe, session.getState, session.getState);
}
