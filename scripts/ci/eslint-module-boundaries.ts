/**
 * Local ESLint rule `atlas/module-boundaries` (no extra dependency): every
 * relative import, re-export or dynamic import in src/, server/ and functions/
 * must keep the layer and public-entry rules of scripts/ci/module-boundaries.ts.
 * Module-level and file-level cycles need the whole graph and are checked by
 * scripts/ci/module-graph.ts (`npm run lint:modules`, and in `npm test`).
 */
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path';
import type { Rule } from 'eslint';
import { checkImport } from './module-boundaries.ts';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../..');

const toRepo = (abs: string): string => relative(ROOT, abs).split(sep).join('/');

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Imports across modules keep the layers and go through public entries (docs/ARCHITECTURE.md §Module dependency rules).',
    },
    schema: [],
    messages: { violation: '{{message}}' },
  },
  create(context) {
    const filename = context.filename;
    if (!isAbsolute(filename)) return {};
    const from = toRepo(filename);
    const check = (node: Rule.Node, source: unknown) => {
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const to = posix.normalize(posix.join(posix.dirname(from), source.replace(/\?.*$/, '')));
      const v = checkImport(from, to);
      if (v) context.report({ node, messageId: 'violation', data: { message: `[${v.rule}] ${v.message}` } });
    };
    return {
      ImportDeclaration: (node) => check(node as Rule.Node, node.source.value),
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node as Rule.Node, node.source.value);
      },
      ExportAllDeclaration: (node) => check(node as Rule.Node, node.source.value),
      ImportExpression: (node) => {
        if (node.source.type === 'Literal') check(node as Rule.Node, node.source.value);
      },
    };
  },
};

export const moduleBoundariesPlugin = { rules: { 'module-boundaries': rule } };
