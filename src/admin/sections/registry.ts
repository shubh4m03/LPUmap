/**
 * Section → lazily loaded component. Each section is its own chunk, so the
 * Studio (and its map) downloads only when opened. A section module must
 * default-export a component taking AdminSectionProps.
 *
 * Ownership: admin-ui owns src/admin/sections/*Section.tsx; studio-ui owns
 * src/admin/studio/** (StudioSection, TemplatesSection).
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { AdminSection } from '../routes.ts';
import type { AdminSectionProps } from './types.ts';

export const SECTION_COMPONENTS: Readonly<
  Record<AdminSection, LazyExoticComponent<ComponentType<AdminSectionProps>>>
> = {
  queue: lazy(() => import('./QueueSection.tsx')),
  locations: lazy(() => import('./LocationsSection.tsx')),
  overrides: lazy(() => import('./OverridesSection.tsx')),
  studio: lazy(() => import('../studio/StudioSection.tsx')),
  templates: lazy(() => import('../studio/TemplatesSection.tsx')),
  artwork: lazy(() => import('./artwork/ArtworkSection.tsx')),
  audit: lazy(() => import('./AuditSection.tsx')),
  quality: lazy(() => import('./QualitySection.tsx')),
};
