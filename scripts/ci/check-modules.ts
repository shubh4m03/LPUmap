/**
 * Module boundaries of src/, server/ and functions/ (docs/ARCHITECTURE.md
 * §Module dependency rules).
 *
 *   node scripts/ci/check-modules.ts [--graph]
 *
 * Exits 1 on a layer or public-entry violation, a module-level import cycle or a
 * file-level runtime import cycle. --graph also prints every module's imports.
 */
import { analyzeModuleGraph, collectImports, REPO_ROOT } from './module-graph.ts';

const report = analyzeModuleGraph(collectImports(REPO_ROOT));
console.log(
  `Module graph: ${report.files} files, ${report.edges} relative imports, ${report.crossModuleEdges} across modules.`,
);
if (process.argv.includes('--graph')) {
  for (const [m, deps] of [...report.moduleEdges].sort(([a], [b]) => (a < b ? -1 : 1)))
    console.log(`  ${m} -> ${[...deps].sort().join(', ')}`);
}
const problems: string[] = [
  ...report.violations.map((v) => `[${v.rule}] ${v.from} -> ${v.to}: ${v.message}`),
  ...report.moduleCycles.map((c) => `[module-cycle] ${c.join(' <-> ')}`),
  ...report.moduleCycleEdges.map((e) => `    ${e}`),
  ...report.fileCycles.map((c) => `[file-cycle] ${c.join(' <-> ')}`),
];
if (problems.length > 0) {
  console.error(`\nlint:modules FAILED:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exitCode = 1;
} else {
  console.log('lint:modules OK: layers and public entries hold; no module or file import cycle.');
}
