import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SourcesSection } from '../../../src/components/about/SourcesSection.tsx';
import { manifestSchema, type Manifest } from '../../../src/data/schema.ts';

afterEach(() => cleanup());

/** The shipped manifest: its licence records are what the About panel must link. */
const shipped = (): Manifest =>
  manifestSchema.parse(JSON.parse(fs.readFileSync(path.resolve('public/data/manifest.json'), 'utf8')));

const itemFor = (name: RegExp) => screen.getByText(name).closest('li')!;

describe('SourcesSection licence links', () => {
  it('links the Microsoft source, its CDLA Permissive 2.0 licence and the shipped licence text', () => {
    render(<SourcesSection manifest={shipped()} />);
    const ms = within(itemFor(/Microsoft Global ML Building Footprints/));
    expect(ms.getByRole('link', { name: /Microsoft Global ML Building Footprints/ })).toHaveAttribute(
      'href',
      'https://github.com/microsoft/GlobalMLBuildingFootprints',
    );
    expect(ms.getByRole('link', { name: /CDLA-Permissive-2\.0/ })).toHaveAttribute(
      'href',
      'https://cdla.dev/permissive-2-0/',
    );
    expect(ms.getByRole('link', { name: 'Full licence text' })).toHaveAttribute(
      'href',
      '/data/licenses/CDLA-Permissive-2.0.txt',
    );
    expect(fs.existsSync(path.resolve('public/data/licenses/CDLA-Permissive-2.0.txt'))).toBe(true);
  });

  it('links Google Open Buildings and its ODbL licence', () => {
    render(<SourcesSection manifest={shipped()} />);
    const g = within(itemFor(/^Google Open Buildings$/));
    expect(g.getByRole('link', { name: /Google Open Buildings/ })).toHaveAttribute(
      'href',
      'https://sites.research.google/gr/open-buildings/',
    );
    expect(g.getByRole('link', { name: /ODbL 1\.0/ })).toHaveAttribute(
      'href',
      'https://opendatacommons.org/licenses/odbl/1-0/',
    );
    expect(g.queryByRole('link', { name: 'Full licence text' })).toBeNull();
  });

  it('never links an unsafe URL or a licence path that leaves the app', () => {
    const m = shipped();
    m.sources = [
      {
        id: 'other-source',
        name: 'Odd Source',
        url: 'javascript:alert(1)',
        license: 'Some licence',
        licenseUrl: 'http://user:pw@example.test/l',
        licenseTextPath: '../../etc/passwd',
        retrievedAt: '2026-01-01',
      } as Manifest['sources'][number],
    ];
    render(<SourcesSection manifest={m} />);
    const item = within(itemFor(/Odd Source/));
    expect(item.queryAllByRole('link')).toHaveLength(0);
    expect(item.getByText(/Some licence/)).toBeInTheDocument();
  });
});
