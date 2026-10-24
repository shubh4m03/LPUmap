import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminContext, type AdminServices } from '../../../src/admin/context.ts';
import type { AdminApi } from '../../../src/admin/api/index.ts';
import TemplatesSection from '../../../src/admin/studio/TemplatesSection.tsx';
import { starterLibrary } from '../../../src/building-studio/asset-library.ts';
import type { TemplateListing } from '../../../src/building-studio/schema.ts';
import { fakeStudioApi, ok, problem } from './studio-fakes.ts';

const OWNER_ID = 'stv:abcdefghijklmnopqrstuvwx';

function listings(ownerStatus: 'active' | 'retired' = 'active'): TemplateListing[] {
  const code = starterLibrary().map((e) => ({
    source: 'code' as const,
    status: 'active' as const,
    definition: e.definition,
    versions: [e.definition.version],
    revision: null,
  }));
  const base = starterLibrary()[0]!.definition;
  return [
    ...code,
    {
      source: 'owner',
      status: ownerStatus,
      definition: { ...base, id: OWNER_ID, name: 'My teaching block', version: 2 },
      versions: [1, 2],
      revision: 4,
    },
  ];
}

function setup(configure: (api: ReturnType<typeof fakeStudioApi>) => void) {
  const studio = fakeStudioApi();
  configure(studio);
  const navigate = vi.fn();
  render(
    <AdminContext value={{ api: { studio } as unknown as AdminApi, session: {} as never } as AdminServices}>
      <TemplatesSection route={{ section: 'templates', id: null, query: {} }} navigate={navigate} />
    </AdminContext>,
  );
  return { studio, navigate, user: userEvent.setup() };
}

afterEach(cleanup);

describe('Templates management', () => {
  it('lists the owner and built-in templates with versions, and explains that GLB import is not enabled', async () => {
    setup((api) => api.library.mockResolvedValue(ok({ templates: listings() })));
    const owner = await screen.findByTestId(`template-card-${OWNER_ID}`);
    expect(owner).toHaveTextContent('My teaching block');
    expect(owner).toHaveTextContent('versions: 1, 2');
    expect(screen.getByRole('heading', { name: 'Built-in templates (17)' })).toBeInTheDocument();
    const glb = screen.getByRole('region', { name: 'Import a 3D model (GLB / glTF)' });
    expect(glb).toHaveTextContent('Not enabled');
    expect(within(glb).getByRole('button')).toBeDisabled();
  });

  it('retire sends the revision and says existing buildings are unchanged; a failure is shown', async () => {
    const t = setup((api) => api.library.mockResolvedValue(ok({ templates: listings() })));
    const owner = await screen.findByTestId(`template-card-${OWNER_ID}`);
    t.studio.retireTemplate.mockResolvedValueOnce(problem(409, 'conflict', 'Changed elsewhere'));
    await t.user.click(within(owner).getByRole('button', { name: 'Retire' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Changed elsewhere');
    t.studio.retireTemplate.mockResolvedValueOnce(ok(listings('retired').at(-1)!));
    t.studio.library.mockResolvedValue(ok({ templates: listings('retired') }));
    await t.user.click(within(owner).getByRole('button', { name: 'Retire' }));
    expect(t.studio.retireTemplate).toHaveBeenLastCalledWith(OWNER_ID, { revision: 4 });
    expect(await screen.findByRole('status')).toHaveTextContent('Existing buildings are unchanged');
    await waitFor(() =>
      expect(
        within(screen.getByTestId(`template-card-${OWNER_ID}`)).getByText('Retired'),
      ).toBeInTheDocument(),
    );
  });

  it('creates an owner template from a built-in one (generic prefab, based on that version)', async () => {
    const t = setup((api) => api.library.mockResolvedValue(ok({ templates: listings() })));
    const first = starterLibrary()[0]!.definition;
    const card = await screen.findByTestId(`template-card-${first.id}`);
    await t.user.click(within(card).getByRole('button', { name: 'Make my own from this' }));
    const form = screen.getByRole('region', { name: 'Template form' });
    t.studio.createTemplate.mockImplementation(async (def: unknown) =>
      ok(
        {
          ...listings().at(-1)!,
          definition: { ...listings().at(-1)!.definition, ...(def as object), version: 1 },
        },
        201,
      ),
    );
    await t.user.click(within(form).getByRole('button', { name: 'Create template' }));
    const sent = t.studio.createTemplate.mock.calls[0]![0] as {
      accuracyClass: string;
      basedOn: unknown;
      name: string;
    };
    expect(sent.accuracyClass).toBe('generic-prefab');
    expect(sent.basedOn).toEqual({ templateId: first.id, templateVersion: first.version });
    expect(sent.name).toContain('(my variant)');
    expect(await screen.findByRole('status')).toHaveTextContent('Created');
  });
});
