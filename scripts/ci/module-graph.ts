/**
 * The import graph of src/, server/ and functions/, checked against the module
 * map (scripts/ci/module-boundaries.ts):
 *
 *  - every cross-module import keeps the layer and public-entry rules (the same
 *    check ESLint runs per file, here over the whole tree);
 *  - the module graph has no cycle (two modules that import each other, directly
 *    or through others, type-only imports included);
 *  - no file-level runtime import cycle (`import type` is erased and ignored here).
 *
 * The CLI is scripts/ci/check-modules.ts (`npm run lint:modules`);
 * tests/unit/ci/module-graph.test.ts runs the same check in `npm test`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import {
  checkImport,
  MODULE_UNITS,
  unitOf,
  type BoundaryViolation,
  type ModuleUnit,
} from './module-boundaries.ts';

export const GRAPH_ROOTS = ['src', 'server', 'functions'] as const;

export interface ImportEdge {
  /** Repository-relative importing file. */
  from: string;
  /** Repository-relative target (resolved from the relative specifier, query stripped). */
  to: string;
  /** `import type …`, `import { type A }` with only type specifiers, or `export type … from`. */
  typeOnly: boolean;
  /** `import('…')`. */
  dynamic: boolean;
  line: number;
}

const toPosix = (p: string): string => p.split(sep).join('/');

function listSources(root: string, dir: string, out: string[]): void {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, e.name);
    if (e.isDirectory()) listSources(root, rel, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(rel);
  }
}

function typeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // side-effect import
  if (clause.isTypeOnly) return true;
  const b = clause.namedBindings;
  return (
    !clause.name &&
    b !== undefined &&
    ts.isNamedImports(b) &&
    b.elements.length > 0 &&
    b.elements.every((e) => e.isTypeOnly)
  );
}

function typeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) return true;
  const c = node.exportClause;
  return (
    c !== undefined && ts.isNamedExports(c) && c.elements.length > 0 && c.elements.every((e) => e.isTypeOnly)
  );
}

/** Relative imports of one source file (bare package imports are not module edges). */
export function importsOf(file: string, code: string): ImportEdge[] {
  const sf = ts.createSourceFile(
    file,
    code,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const edges: ImportEdge[] = [];
  const add = (spec: string, node: ts.Node, typeOnly: boolean, dynamic: boolean) => {
    if (!spec.startsWith('.')) return;
    const target = posix.normalize(posix.join(posix.dirname(file), spec.replace(/\?.*$/, '')));
    edges.push({
      from: file,
      to: target,
      typeOnly,
      dynamic,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node, typeOnlyImport(node), false);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier.text, node, typeOnlyExport(node), false);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      add(node.arguments[0].text, node, false, true);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal.text, node, true, false); // `import('…').T` in a type position
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return edges;
}

/** Every relative import under GRAPH_ROOTS of the repository at `root`. */
export function collectImports(root: string): ImportEdge[] {
  const files: string[] = [];
  for (const r of GRAPH_ROOTS) listSources(root, r, files);
  return files.flatMap((f) => importsOf(f, readFileSync(join(root, f), 'utf8')));
}

/** Strongly connected components with more than one node (or a self-loop), each sorted. */
export function findCycles(edges: ReadonlyMap<string, ReadonlySet<string>>): string[][] {
  let next = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const nodes = new Set<string>();
  for (const [a, bs] of edges) {
    nodes.add(a);
    for (const b of bs) nodes.add(b);
  }
  // Iterative Tarjan: the file graph is deep enough to make recursion a risk.
  for (const start of [...nodes].sort()) {
    if (index.has(start)) continue;
    const work: { node: string; it: Iterator<string> }[] = [];
    const open = (n: string) => {
      index.set(n, next);
      low.set(n, next);
      next++;
      stack.push(n);
      onStack.add(n);
      work.push({ node: n, it: [...(edges.get(n) ?? [])].sort()[Symbol.iterator]() });
    };
    open(start);
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      const step = top.it.next();
      if (!step.done) {
        const w = step.value;
        if (!index.has(w)) open(w);
        else if (onStack.has(w)) low.set(top.node, Math.min(low.get(top.node)!, index.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(top.node)!));
      if (low.get(top.node) === index.get(top.node)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== top.node);
        if (scc.length > 1 || edges.get(top.node)?.has(top.node)) cycles.push(scc.sort());
      }
    }
  }
  return cycles.sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
}

export interface ModuleGraphReport {
  files: number;
  edges: number;
  crossModuleEdges: number;
  violations: BoundaryViolation[];
  /** Module ids per cycle (type-only and dynamic imports included). */
  moduleCycles: string[][];
  /** For each module cycle, the edges that close it: `a -> b: file:line`. */
  moduleCycleEdges: string[];
  /** File-level cycles over static runtime imports. */
  fileCycles: string[][];
  /** Module → modules it imports. */
  moduleEdges: Map<string, Set<string>>;
}

const addEdge = (m: Map<string, Set<string>>, a: string, b: string) => {
  if (!m.has(a)) m.set(a, new Set());
  m.get(a)!.add(b);
};

export function analyzeModuleGraph(
  edges: readonly ImportEdge[],
  units: readonly ModuleUnit[] = MODULE_UNITS,
): ModuleGraphReport {
  const violations: BoundaryViolation[] = [];
  const moduleEdges = new Map<string, Set<string>>();
  const fileEdges = new Map<string, Set<string>>();
  const files = new Set<string>();
  let cross = 0;
  for (const e of edges) {
    files.add(e.from);
    const v = checkImport(e.from, e.to, units);
    if (v) violations.push({ ...v, from: `${e.from}:${e.line}` });
    const a = unitOf(e.from, units);
    const b = unitOf(e.to, units);
    if (a && b && a !== b) {
      cross++;
      addEdge(moduleEdges, a.id, b.id);
    }
    if (!e.typeOnly && !e.dynamic) addEdge(fileEdges, e.from, e.to);
  }
  const moduleCycles = findCycles(moduleEdges);
  const moduleCycleEdges: string[] = [];
  for (const cycle of moduleCycles) {
    const members = new Set(cycle);
    for (const e of edges) {
      const a = unitOf(e.from, units)?.id;
      const b = unitOf(e.to, units)?.id;
      if (a && b && a !== b && members.has(a) && members.has(b))
        moduleCycleEdges.push(`${a} -> ${b}: ${e.from}:${e.line}${e.typeOnly ? ' (type)' : ''}`);
    }
  }
  return {
    files: files.size,
    edges: edges.length,
    crossModuleEdges: cross,
    violations,
    moduleCycles,
    moduleCycleEdges,
    fileCycles: findCycles(fileEdges),
    moduleEdges,
  };
}

/** The repository root (two levels above this file). */
export const REPO_ROOT = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '../..',
);

export const repoRelative = (absPath: string): string => toPosix(relative(REPO_ROOT, absPath));
