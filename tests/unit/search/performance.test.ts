import { describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../../../src/config/index.ts';
import { createSearchIndex, type SearchDoc } from '../../../src/search/index.ts';
import { medianTime, percentile } from '../perf-timing.ts';

// Synthetic vocabulary — invented strings used only to load the engine.
const WORDS = [
  'academic',
  'block',
  'hostel',
  'boys',
  'girls',
  'library',
  'central',
  'canteen',
  'pharmacy',
  'gate',
  'auditorium',
  'management',
  'engineering',
  'science',
  'law',
  'design',
  'hall',
  'mall',
  'office',
  'admin',
  'sports',
  'ground',
  'stadium',
  'workshop',
  'laboratory',
  'research',
  'chapel',
  'garden',
  'court',
  'parking',
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function syntheticDocs(n: number): SearchDoc[] {
  const r = rng(7);
  const pick = (): string => WORDS[Math.floor(r() * WORDS.length)]!;
  return Array.from({ length: n }, (_, i) => {
    const words = Array.from({ length: 2 + Math.floor(r() * 3) }, pick);
    const title = `${words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ')} ${i % 97}`;
    return {
      id: `syn-${i}`,
      kind: 'place',
      title,
      aliases: r() < 0.3 ? [`${pick()} ${i}`] : [],
      codes: r() < 0.2 ? [`X${i}`] : [],
      keywords: [pick(), pick()],
      ref: `syn-${i}`,
      hasLocation: true,
    };
  });
}

function syntheticQueries(n: number): string[] {
  const r = rng(11);
  const pick = (): string => WORDS[Math.floor(r() * WORDS.length)]!;
  const makers = [
    () => pick(),
    () => pick().slice(0, 3),
    () => `${pick()} ${pick()}`,
    () => `${pick()} ${Math.floor(r() * 97)}`,
    () => {
      const w = pick();
      const k = 1 + Math.floor(r() * (w.length - 2));
      return w.slice(0, k) + w.slice(k + 1);
    },
    () => `x${Math.floor(r() * 5000)}`,
    () => 'zzqx unknown words here',
    () => `${pick()} of the ${pick()} ${pick()}`,
  ];
  return Array.from({ length: n }, (_, i) => makers[i % makers.length]!());
}

/**
 * Query cost scales with vocabulary size (one match code per distinct word), so
 * also measure a corpus of ~4,000 distinct pseudo-words — far more than the real dataset.
 */
function pseudoWord(r: () => number): string {
  const letters = 'abcdefghiklmnoprstuvy';
  const len = 4 + Math.floor(r() * 7);
  let w = '';
  for (let i = 0; i < len; i++) w += letters[Math.floor(r() * letters.length)]!;
  return w;
}

function largeVocabDocs(n: number): { docs: SearchDoc[]; vocab: string[] } {
  const r = rng(23);
  const vocab = Array.from({ length: 4000 }, () => pseudoWord(r));
  const pick = (): string => vocab[Math.floor(r() * vocab.length)]!;
  const docs = Array.from({ length: n }, (_, i) => ({
    id: `big-${i}`,
    kind: 'place' as const,
    title: `${pick()} ${pick()} ${pick()}`,
    aliases: [pick()],
    codes: [],
    keywords: [pick()],
    ref: `big-${i}`,
    hasLocation: true,
  }));
  return { docs, vocab };
}

/** Each query is timed this many times; its median is its latency. */
const REPETITIONS = 5;

/**
 * p95 over the per-query median latencies, after one untimed warm-up pass over every
 * query (JIT and lazily built per-word match codes). A single slow sample caused by
 * another test worker cannot fail the budget; a genuinely slow query is slow in every
 * repetition and still does.
 */
function p95Of(
  index: ReturnType<typeof createSearchIndex>,
  queries: string[],
): { p95: number; hits: number } {
  for (const q of queries) index.search(q);
  const latencies: number[] = [];
  let hits = 0;
  for (const q of queries) {
    hits += index.search(q).length;
    latencies.push(
      medianTime(
        REPETITIONS,
        () => q,
        (query) => index.search(query),
      ),
    );
  }
  return { p95: percentile(latencies, 0.95), hits };
}

describe('search performance', () => {
  const budget = APP_CONFIG.performance.searchBudgetMs;

  it(`keeps p95 query latency under ${budget} ms on 5,000 docs`, () => {
    const index = createSearchIndex(syntheticDocs(5000));
    expect(index.size).toBe(5000);
    const { p95, hits } = p95Of(index, syntheticQueries(200));
    console.info(`search p95 ${p95.toFixed(2)} ms`);
    expect(hits).toBeGreaterThan(0);
    expect(p95).toBeLessThan(budget);
  });

  it(`stays under ${budget} ms p95 with a ~4,000-word vocabulary`, () => {
    const { docs, vocab } = largeVocabDocs(5000);
    const index = createSearchIndex(docs);
    const r = rng(5);
    const pick = (): string => vocab[Math.floor(r() * vocab.length)]!;
    const queries = Array.from({ length: 200 }, (_, i) => {
      const w = pick();
      if (i % 4 === 0) return w;
      if (i % 4 === 1) return `${w.slice(0, 2)}${w.slice(3)}`;
      if (i % 4 === 2) return `${pick()} ${w.slice(0, 3)}`;
      return `${pick()} ${pick()} ${pick()} ${pick()}`;
    });
    const { p95, hits } = p95Of(index, queries);
    console.info(`large-vocabulary search p95 ${p95.toFixed(2)} ms`);
    expect(hits).toBeGreaterThan(0);
    expect(p95).toBeLessThan(budget);
  });
});
