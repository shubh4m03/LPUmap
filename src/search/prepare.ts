/** Index-time precomputation: every normalised field is built once, never per query. */
import { analyze, isDigitToken, STOPWORDS, type AnalyzedText } from './normalize.ts';
import type { SearchDoc } from './types.ts';

export interface Initialism {
  code: string;
  /** Title token indexes whose first letter (or whole number) forms the code. */
  tokenIndexes: number[];
}

export interface PreparedDoc {
  doc: SearchDoc;
  title: AnalyzedText;
  /** Offsets of each title word inside `title.compact`. */
  compactWordStarts: number[];
  aliases: AnalyzedText[];
  codes: string[];
  initialisms: Initialism[];
  keywordKeys: string[];
  titleWordIds: number[];
  aliasWordIds: number[];
  keywordWordIds: number[];
}

export interface Vocabulary {
  words: string[];
  ids: Map<string, number>;
}

function wordId(vocab: Vocabulary, word: string): number {
  let id = vocab.ids.get(word);
  if (id === undefined) {
    id = vocab.words.length;
    vocab.words.push(word);
    vocab.ids.set(word, id);
  }
  return id;
}

/**
 * Initialism of a multiword name ignoring stopwords: 'Lovely Institute of
 * Management' → 'lim', 'Boys Hostel 4' → 'bh4'. Needs at least two words.
 */
export function initialismOf(analyzed: AnalyzedText): Initialism | null {
  const tokenIndexes: number[] = [];
  let code = '';
  analyzed.tokens.forEach((t, i) => {
    if (STOPWORDS.has(t)) return;
    tokenIndexes.push(i);
    code += isDigitToken(t) ? t : t.charAt(0);
  });
  if (tokenIndexes.length < 2 || code.length < 2) return null;
  return { code, tokenIndexes };
}

function strings(list: unknown): string[] {
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string' && s.trim() !== '') : [];
}

export function prepareDoc(doc: SearchDoc, vocab: Vocabulary): PreparedDoc {
  const title = analyze(typeof doc.title === 'string' ? doc.title : '');
  const aliases = strings(doc.aliases)
    .map(analyze)
    .filter((a) => a.key !== '');
  const codes = [...new Set(strings(doc.codes).map((c) => analyze(c).compact))].filter((c) => c !== '');

  const initialisms: Initialism[] = [];
  const own = initialismOf(title);
  if (own) initialisms.push(own);
  for (const alias of aliases) {
    const ini = initialismOf(alias);
    if (ini) initialisms.push({ code: ini.code, tokenIndexes: [] });
  }

  const keywordAnalyses = strings(doc.keywords).map(analyze);
  const keywordKeys = [...new Set(keywordAnalyses.map((k) => k.key))].filter((k) => k !== '');

  const compactWordStarts: number[] = [];
  let offset = 0;
  for (const t of title.tokens) {
    compactWordStarts.push(offset);
    offset += t.length;
  }

  const ids = (tokens: string[]): number[] => [...new Set(tokens.map((t) => wordId(vocab, t)))];
  return {
    doc,
    title,
    compactWordStarts,
    aliases,
    codes,
    initialisms,
    keywordKeys,
    titleWordIds: title.tokens.map((t) => wordId(vocab, t)),
    aliasWordIds: ids(aliases.flatMap((a) => a.tokens)),
    keywordWordIds: ids(keywordAnalyses.flatMap((k) => k.tokens)),
  };
}
