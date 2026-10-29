// @vitest-environment node
/**
 * Module boundaries (docs/ARCHITECTURE.md §Module dependency rules, G-26/G-27):
 * the real import graph of src/, server/ and functions/ keeps the layers, crosses
 * modules only through public entries, and has no module-level or file-level
 * cycle; the checker and the ESLint rule catch each kind of violation.
 */
import { Linter } from 'eslint';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { moduleBoundariesPlugin } from '../../../scripts/ci/eslint-module-boundaries.ts';
import { checkImport, MODULE_UNITS, unitOf } from '../../../scripts/ci/module-boundaries.ts';
import {
  analyzeModuleGraph,
  collectImports,
  findCycles,
  importsOf,
  REPO_ROOT,
} from '../../../scripts/ci/module-graph.ts';

const report = analyzeModuleGraph(collectImports(REPO_ROOT));
const imports = (a: string, b: string) => report.moduleEdges.get(a)?.has(b) ?? false;

describe('the real module graph', () => {
  it('covers the whole tree', () => {
    expect(report.files).toBeGreaterThan(400);
    expect(report.crossModuleEdges).toBeGreaterThan(500);
  });

  it('keeps every layer rule and imports other modules only through their public entries', () => {
    expect(report.violations.map((v) => `${v.from} -> ${v.to}: ${v.message}`)).toEqual([]);
  });

  it('has no module-level cycle, type-only and lazy imports included', () => {
    expect([...report.moduleCycles.map((c) => c.join(' <-> ')), ...report.moduleCycleEdges]).toEqual([]);
  });

  it('has no file-level runtime import cycle', () => {
    expect(report.fileCycles.map((c) => c.join(' <-> '))).toEqual([]);
  });

  // The two-way links and wrong-way imports the audit found (G-26), named so a
  // regression says which one came back.
  it.each([
    ['building-studio/ui', 'admin'],
    ['isometric', 'app'],
    ['isometric-art', 'app'],
    ['isometric-art/view', 'app'],
    ['map', 'app'],
    ['map', 'components/ui'],
    ['buildings3d', 'map'],
    ['building-studio', 'community'],
    ['isometric-art', 'directory'],
    ['building-studio', 'map'],
    ['map', 'building-studio/ui'],
  ])('%s does not import %s', (from, to) => {
    expect(imports(from, to)).toBe(false);
  });

  it('the overview stages are app glue (src/app), not part of the view modules', () => {
    expect(unitOf('src/app/IsoStage.tsx')?.id).toBe('app');
    expect(unitOf('src/app/IsometricModeStage.tsx')?.id).toBe('app');
  });
});

describe('checkImport', () => {
  it('maps files to the most specific unit', () => {
    expect(unitOf('src/components/ui/Button.tsx')?.id).toBe('components/ui');
    expect(unitOf('src/components/search/SearchPanel.tsx')?.id).toBe('app');
    expect(unitOf('src/building-studio/ui/store.ts')?.id).toBe('building-studio/ui');
    expect(unitOf('src/building-studio/schema.ts')?.id).toBe('building-studio');
    expect(unitOf('src/isometric-art/view/IllustratedOverview.tsx')?.id).toBe('isometric-art/view');
    expect(unitOf('src/main.tsx')?.id).toBe('main');
    expect(unitOf('tests/unit/x.test.ts')).toBeNull();
    expect(unitOf('scripts/build-data.ts')).toBeNull();
  });

  it('allows a lower layer through its public entry, and same-module internals', () => {
    expect(checkImport('src/map/style.ts', 'src/config/index.ts')).toBeNull();
    expect(checkImport('src/map/MapView.tsx', 'src/map/style.ts')).toBeNull();
    expect(checkImport('src/app/MapStage.tsx', 'src/map/providers/index.ts')).toBeNull();
    expect(checkImport('src/app/MapStage.tsx', 'src/components/search/SearchPanel.tsx')).toBeNull();
    expect(checkImport('src/map/MapView.tsx', 'src/utils/safe-url.ts')).toBeNull();
  });

  it('flags an import of another module’s internal file', () => {
    expect(checkImport('src/routing/router.ts', 'src/distance/geodesic.ts')).toMatchObject({
      rule: 'public-entry',
      fromUnit: 'routing',
      toUnit: 'distance',
    });
    expect(checkImport('src/admin/AdminApp.tsx', 'src/components/ui/Button.tsx')?.rule).toBe('public-entry');
  });

  it('flags an import that points up a layer, type-only or not', () => {
    expect(checkImport('src/map/providers/registry.ts', 'src/app/view-mode.ts')).toMatchObject({
      rule: 'layer',
      fromUnit: 'map',
      toUnit: 'app',
    });
    expect(checkImport('src/building-studio/ui/actions.ts', 'src/admin/api/index.ts')?.rule).toBe('layer');
    expect(checkImport('src/data/schema.ts', 'src/map/index.ts')?.rule).toBe('layer');
  });

  it('keeps the server on the pure layers and functions/ on the server', () => {
    expect(checkImport('server/base-data.ts', 'src/data/index.ts')).toBeNull();
    expect(checkImport('server/base-data.ts', 'src/map/index.ts')?.rule).toBe('layer');
    expect(checkImport('src/app/App.tsx', 'server/errors.ts')?.rule).toBe('layer');
    expect(checkImport('functions/api/health.ts', 'server/handlers/health.ts')).toBeNull();
    expect(checkImport('functions/api/health.ts', 'src/data/index.ts')?.rule).toBe('layer');
  });

  it('declares every unit’s entries as files that exist', async () => {
    const { existsSync } = await import('node:fs');
    for (const u of MODULE_UNITS) {
      for (const p of u.paths) expect(existsSync(join(REPO_ROOT, p)), p).toBe(true);
      if (u.entries !== 'any')
        for (const e of u.entries)
          expect(existsSync(join(REPO_ROOT, u.paths[0]!, e)), `${u.id}: ${e}`).toBe(true);
    }
  });
});

describe('graph helpers', () => {
  it('finds cycles, including a self-loop, and nothing in a DAG', () => {
    const g = (edges: [string, string][]) => {
      const m = new Map<string, Set<string>>();
      for (const [a, b] of edges) m.set(a, new Set([...(m.get(a) ?? []), b]));
      return m;
    };
    expect(
      findCycles(
        g([
          ['a', 'b'],
          ['b', 'c'],
          ['c', 'a'],
          ['c', 'd'],
        ]),
      ),
    ).toEqual([['a', 'b', 'c']]);
    expect(findCycles(g([['x', 'x']]))).toEqual([['x']]);
    expect(
      findCycles(
        g([
          ['a', 'b'],
          ['b', 'c'],
          ['a', 'c'],
        ]),
      ),
    ).toEqual([]);
  });

  it('reads import kinds: type-only, re-export, dynamic, type position', () => {
    const edges = importsOf(
      'src/app/x.ts',
      [
        "import type { A } from '../map/index.ts';",
        "import { type B } from '../data/index.ts';",
        "import { C, type D } from '../config/index.ts';",
        "export { E } from './e.ts';",
        "const m = import('./lazy.tsx');",
        "type F = import('../routing/index.ts').Route;",
        "import 'react';",
      ].join('\n'),
    );
    expect(edges.map((e) => [e.to, e.typeOnly, e.dynamic])).toEqual([
      ['src/map/index.ts', true, false],
      ['src/data/index.ts', true, false],
      ['src/config/index.ts', false, false],
      ['src/app/e.ts', false, false],
      ['src/app/lazy.tsx', false, true],
      ['src/routing/index.ts', true, false],
    ]);
  });

  it('reports a cycle between modules even when each import keeps the layer rule', () => {
    const r = analyzeModuleGraph([
      { from: 'src/map/a.ts', to: 'src/buildings3d/index.ts', typeOnly: false, dynamic: false, line: 1 },
      { from: 'src/buildings3d/b.ts', to: 'src/map/index.ts', typeOnly: true, dynamic: false, line: 2 },
    ]);
    expect(r.violations).toEqual([]);
    expect(r.moduleCycles).toEqual([['buildings3d', 'map']]);
  });
});

describe('ESLint rule atlas/module-boundaries', () => {
  const linter = new Linter({ configType: 'flat' });
  const lint = (file: string, code: string) =>
    linter
      .verify(
        code,
        [
          {
            files: ['**/*.ts'],
            languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
            plugins: { atlas: moduleBoundariesPlugin },
            rules: { 'atlas/module-boundaries': 'error' },
          },
        ],
        join(REPO_ROOT, file),
      )
      .map((m) => m.message);

  it('reports a deep import and a wrong-way import, and passes a public-entry import', () => {
    expect(lint('src/routing/x.ts', "import { haversineM } from '../distance/geodesic.ts';")).toEqual([
      expect.stringMatching(/^\[public-entry\] src\/distance\/geodesic\.ts is internal to distance/),
    ]);
    expect(lint('src/map/x.ts', "export { useAppStore } from '../app/store/index.ts';")).toEqual([
      expect.stringMatching(/^\[layer\] map \(view\) must not import app \(app\)/),
    ]);
    expect(lint('src/map/x.ts', "const m = import('../admin/AdminApp.tsx');")).toHaveLength(1);
    expect(lint('src/routing/x.ts', "import { haversineM } from '../distance/index.ts';")).toEqual([]);
  });

  it('leaves tests, scripts and package imports alone', () => {
    expect(lint('tests/unit/x.test.ts', "import { a } from '../../src/distance/geodesic.ts';")).toEqual([]);
    expect(lint('src/map/x.ts', "import maplibregl from 'maplibre-gl';")).toEqual([]);
  });
});
