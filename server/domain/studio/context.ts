/**
 * Per-call context for Building Studio operations. Built by the HTTP layer
 * after authentication: `actor` is the verified owner (never read from a
 * body), `now` the server clock, `studio` the current base dataset as the
 * validator sees it. `validate` and `library` are injectable so tests can
 * fault-inject; production uses the shared validator and the code library.
 */
import type {
  StudioDraft,
  TemplateDefinition,
  ValidationResult,
  PublishedStudioBuilding,
} from '../../../src/building-studio/index.ts';
import type { StudioBaseData } from '../../base-data.ts';
import { randomIds, type IdGenerator } from '../../ids.ts';
import type { DomainContext } from '../context.ts';

/**
 * The validator's input (docs/BUILDING_STUDIO_DESIGN.md §6.1). Declared here
 * structurally so the server states exactly what it hands over; the shared
 * validator's own `StudioValidationContext` must accept it (checked by tsc in
 * validator.ts).
 */
export interface ServerValidationContext {
  base: Pick<
    StudioBaseData,
    'buildings' | 'places' | 'graph' | 'boundary' | 'reviewSections' | 'curatedDecisions'
  >;
  published: readonly PublishedStudioBuilding[];
  template: TemplateDefinition | null;
  recordId: string | null;
  targetId: string | null;
  today: string;
}

export type StudioValidator = (draft: StudioDraft, ctx: ServerValidationContext) => ValidationResult;

/** Starter (code) templates: every released version of every template. */
export interface CodeTemplateLibrary {
  templates: readonly TemplateDefinition[];
}

export interface StudioContext extends Pick<DomainContext, 'now' | 'actor'> {
  studio: StudioBaseData;
  ids?: IdGenerator;
  /** Defaults to the shared validator (src/building-studio/validate.ts). */
  validate?: StudioValidator;
  /** Defaults to the starter library (src/building-studio/asset-library.ts). */
  library?: CodeTemplateLibrary;
}

export const studioIds = (ctx: StudioContext): IdGenerator => ctx.ids ?? randomIds;
/** Server calendar date (UTC) — verification dates after it are rejected by the validator. */
export const todayOf = (ctx: Pick<StudioContext, 'now'>): string => ctx.now.toISOString().slice(0, 10);
