// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LICENSES,
  disallowed,
  licenseAllowed,
  licenseText,
  packageOfModuleId,
  productionPackages,
  readLockfile,
  renderNotices,
  SERVICE_WORKER_RUNTIME_PACKAGES,
  shippedPackages,
} from '../../../scripts/lib/third-party-licenses.ts';

const root = process.cwd();
const lock = readLockfile(root);
const NUL = String.fromCharCode(0);

// G-22: dependency licence allow-list (runs in CI as part of `npm test`).
describe('licence allow-list', () => {
  it('every production package in package-lock.json has an allowed licence', () => {
    const prod = productionPackages(lock);
    expect(prod.length).toBeGreaterThan(5);
    expect(disallowed(prod)).toEqual([]);
  });

  it('everything the build ships (app bundle, service-worker runtime, generated CSS) is allowed', () => {
    const ids = ['maplibre-gl', 'react', 'react-dom', 'scheduler', 'workbox-window', 'zod', 'zustand'].map(
      (n) => `C:\\repo\\node_modules\\${n}\\index.js`,
    );
    const shipped = shippedPackages(lock, [
      ...ids,
      `${NUL}vite/preload-helper.js`,
      `${NUL}rolldown/runtime.js`,
    ]);
    expect(shipped.map((p) => p.name)).toEqual(
      expect.arrayContaining([...SERVICE_WORKER_RUNTIME_PACKAGES, 'vite', 'tailwindcss']),
    );
    expect(disallowed(shipped)).toEqual([]);
  });

  it('evaluates SPDX expressions and refuses copyleft or unknown licences', () => {
    expect(licenseAllowed('MIT')).toBe(true);
    expect(licenseAllowed('(MIT OR Apache-2.0)')).toBe(true);
    expect(licenseAllowed('(GPL-3.0-only OR MIT)')).toBe(true);
    expect(licenseAllowed('MIT AND GPL-3.0-only')).toBe(false);
    for (const bad of ['GPL-3.0-only', 'AGPL-3.0', 'LGPL-2.1', 'SSPL-1.0', 'UNKNOWN', 'UNLICENSED', ''])
      expect(licenseAllowed(bad), bad).toBe(false);
    expect(ALLOWED_LICENSES.has('GPL-3.0-only')).toBe(false);
    expect(disallowed([{ name: 'x', version: '1.0.0', license: 'GPL-2.0' }])).toHaveLength(1);
  });

  it('maps bundled module ids (Windows or POSIX, scoped, nested, virtual helpers) to packages', () => {
    expect(packageOfModuleId('C:\\a\\node_modules\\react-dom\\cjs\\x.js')).toBe('react-dom');
    expect(packageOfModuleId('/a/node_modules/@scope/pkg/x.js')).toBe('@scope/pkg');
    expect(packageOfModuleId('/a/node_modules/x/node_modules/y/z.js')).toBe('y');
    expect(packageOfModuleId(`${NUL}vite/modulepreload-polyfill.js`)).toBe('vite');
    expect(packageOfModuleId('/repo/src/main.tsx')).toBeNull();
    expect(() => shippedPackages(lock, ['/a/node_modules/not-in-the-lockfile-xyz/i.js'])).toThrow(
      /not in package-lock/,
    );
  });
});

describe('notices file', () => {
  it("copies each package's own licence text, with name, version and licence from the lockfile", () => {
    const pkgs = shippedPackages(lock, [
      '/r/node_modules/maplibre-gl/dist/x.js',
      `${NUL}vite/preload-helper.js`,
    ]);
    const text = renderNotices(pkgs, (n) => licenseText(root, n));
    const maplibre = pkgs.find((p) => p.name === 'maplibre-gl')!;
    expect(text).toContain(`maplibre-gl ${maplibre.version}\nLicence: BSD-3-Clause`);
    expect(text).toContain('MapLibre contributors');
    // Vite's own licence only, not the notices of Vite's bundled Node tooling.
    expect(licenseText(root, 'vite')).not.toMatch(/Licenses of bundled dependencies/);
    expect(renderNotices([{ name: 'nofile', version: '1', license: 'MIT' }], () => null)).toContain(
      'does not include a licence file',
    );
  });
});
