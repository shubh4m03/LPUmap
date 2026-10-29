/**
 * Bindings to the shared studio modules owned by studio-core: the pure
 * validator (src/building-studio/validate.ts, the same code the Studio UI
 * runs; the server's result is authoritative) and the starter template
 * library (src/building-studio/asset-library.ts, every released version).
 * Assigning the validator to StudioValidator makes tsc prove that the
 * server's validation context satisfies the validator's contract.
 */
import { STARTER_TEMPLATE_VERSIONS, starterTemplate } from '../../../src/building-studio/editor.ts';
import type { TemplateDefinition } from '../../../src/building-studio/index.ts';
import { validateStudioDraft } from '../../../src/building-studio/editor.ts';
import type { CodeTemplateLibrary, StudioValidator } from './context.ts';

export const sharedValidator: StudioValidator = (draft, ctx) => validateStudioDraft(draft, ctx);

let starter: readonly TemplateDefinition[] | null = null;

/** Every version of every starter template, resolved (meshes measured) once per isolate on first use. */
export const codeLibrary: CodeTemplateLibrary = {
  get templates(): readonly TemplateDefinition[] {
    starter ??= STARTER_TEMPLATE_VERSIONS.map(({ draft, version }) => {
      const entry = starterTemplate(draft.id, version);
      if (!entry) throw new Error(`Starter template ${draft.id} v${version} does not resolve`);
      return entry.definition;
    });
    return starter;
  },
};
