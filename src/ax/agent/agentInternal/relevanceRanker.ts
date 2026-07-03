import { stopwords } from '../../dsp/stopwords.js';

/**
 * Local, deterministic relevance ranker for agent discovery and recall.
 *
 * The domain-neutral core is `rankDocuments`: given a query and a small set of
 * documents (each a bag of weighted text fields), it scores every document
 * with a lightweight BM25-style overlap and returns a shortlist — or nothing
 * when it has no confident signal. Domain adapters (`rankModules` for tool
 * modules; skills/memories catalog searchers) build their documents from the
 * metadata each domain has.
 *
 * It is intentionally pure and dependency-free (only `stopwords` is reused):
 * identical inputs always produce identical output, so it is trivially
 * unit-testable and produces stable telemetry for `agent.optimize()`.
 */

/** One searchable text field of a document. */
export interface AxRankableField {
  text: string;
  /** Term-frequency multiplier (default 1). Use >1 for high-signal fields. */
  weight?: number;
  /** Tokenize as a code identifier (camelCase/snake/kebab) instead of prose. */
  identifier?: boolean;
}

/** A document the ranker can score. */
export interface AxRankableDocument {
  id: string;
  fields: readonly AxRankableField[];
}

/** A single ranked document. */
export interface AxRankedDocument {
  id: string;
  /** Score normalized to 0..1 relative to the top match (top is always 1). */
  score: number;
  /** Query terms that matched this document (for telemetry/debugging). */
  matchedTerms: string[];
}

export interface AxRankDocumentsOptions {
  /** Max documents to return. Default 3. */
  topK?: number;
  /**
   * Absolute floor on the top match's idf-weighted query coverage (0..1).
   * Below this the ranker emits nothing. Default 0.08.
   */
  minScore?: number;
  /**
   * Discrimination guard. If every document scores within this ratio of the
   * top, the ranker can't discriminate and emits nothing. Default 0.15.
   */
  marginRatio?: number;
  /**
   * Minimum catalog size to rank at all (a hint over a 1-item catalog is
   * noise). Default 2. Explicit-search adapters pass 1 for best-effort mode.
   */
  minDocs?: number;
}

const DEFAULT_TOP_K = 3;
const DEFAULT_MIN_SCORE = 0.08;
const DEFAULT_MARGIN_RATIO = 0.15;
const DEFAULT_MIN_DOCS = 2;

const PUNCT_RE = /[!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~]/g;
const DIACRITIC_RE = /[̀-ͯ]/g;

/**
 * Split an identifier into lowercase word tokens, handling camelCase,
 * PascalCase, snake_case, kebab-case, dotted, and ALLCAPS acronym boundaries.
 * e.g. `searchDocsByID` -> `['search', 'docs', 'by', 'id']`,
 * `send_email` -> `['send', 'email']`, `HTTPServer` -> `['http', 'server']`.
 */
export function splitIdentifierWords(identifier: string): string[] {
  return identifier
    .split(/[^A-Za-z0-9]+/)
    .flatMap((chunk) =>
      chunk
        // acronym boundary: HTTPServer -> HTTP Server
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        // camel/number boundary: fooBar -> foo Bar, foo2Bar -> foo2 Bar
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .split(/\s+/)
    )
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

/** Tokenize free text: normalize, strip punctuation/diacritics, drop stopwords. */
function tokenizeText(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(DIACRITIC_RE, '')
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !stopwords.has(t));
}

function addTerms(
  tf: Map<string, number>,
  terms: readonly string[],
  weight: number
): void {
  for (const t of terms) {
    tf.set(t, (tf.get(t) ?? 0) + weight);
  }
}

/** Build a weighted term-frequency map for one document. */
function buildDocumentTermFreq(doc: AxRankableDocument): Map<string, number> {
  const tf = new Map<string, number>();
  for (const field of doc.fields) {
    if (!field.text) continue;
    const terms = field.identifier
      ? splitIdentifierWords(field.text)
      : tokenizeText(field.text);
    addTerms(tf, terms, field.weight ?? 1);
  }
  return tf;
}

/**
 * Rank documents against a query. Returns a shortlist (most relevant first),
 * or `[]` when the ranker has no confident signal — callers must treat `[]`
 * as "no result", not an error.
 */
export function rankDocuments(
  query: string,
  docs: readonly AxRankableDocument[],
  opts?: AxRankDocumentsOptions
): AxRankedDocument[] {
  const topK = opts?.topK ?? DEFAULT_TOP_K;
  const minScore = opts?.minScore ?? DEFAULT_MIN_SCORE;
  const marginRatio = opts?.marginRatio ?? DEFAULT_MARGIN_RATIO;
  const minDocs = opts?.minDocs ?? DEFAULT_MIN_DOCS;

  if (docs.length < minDocs) return [];

  const indexed = docs.map((doc) => ({
    doc,
    tf: buildDocumentTermFreq(doc),
  }));
  const N = indexed.length;

  // Document frequency across the (small) catalog.
  const df = new Map<string, number>();
  for (const d of indexed) {
    for (const term of d.tf.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  // Only query terms that appear in at least one document can discriminate.
  const queryTerms = new Set(tokenizeText(query));
  const effective = [...queryTerms].filter((t) => df.has(t));
  if (effective.length === 0) return [];

  const idf = new Map<string, number>();
  for (const t of effective) {
    idf.set(t, Math.log(1 + N / (df.get(t) as number)));
  }
  const totalIdf = effective.reduce((s, t) => s + (idf.get(t) as number), 0);

  const scored = indexed.map(({ doc, tf }) => {
    let raw = 0;
    let coverage = 0;
    const matched: string[] = [];
    for (const t of effective) {
      const f = tf.get(t);
      if (f && f > 0) {
        const w = idf.get(t) as number;
        raw += w * (f / (f + 1)); // tf saturation, no length norm (tiny docs)
        coverage += w;
        matched.push(t);
      }
    }
    return {
      id: doc.id,
      raw,
      coverage: coverage / totalIdf,
      matched,
    };
  });

  scored.sort((a, b) => b.raw - a.raw || a.id.localeCompare(b.id));

  const top = scored[0];
  if (!top || top.raw <= 0) return []; // nothing matched
  if (top.coverage < minScore) return []; // top match is trivially weak

  // If every document is within marginRatio of the top, the ranker can't
  // discriminate — the whole catalog is effectively tied, so emit nothing.
  if (marginRatio > 0) {
    const nearTop = scored.filter(
      (s) => s.raw > 0 && (top.raw - s.raw) / top.raw < marginRatio
    );
    if (nearTop.length >= N && N >= 2) return [];
  }

  return scored
    .filter((s) => s.raw > 0)
    .slice(0, topK)
    .map((s) => ({
      id: s.id,
      score: s.raw / top.raw,
      matchedTerms: s.matched,
    }));
}

// ----- Module domain adapter -----

/** A module the ranker can score, flattened from agent function-group metadata. */
export interface AxModuleRankInput {
  namespace: string;
  title?: string;
  selectionCriteria?: string;
  description?: string;
  /** Bare function names in the module, e.g. `['search', 'read']`. */
  functionNames?: readonly string[];
  /** Union of parameter property names across the module's functions. */
  argNames?: readonly string[];
}

/** A single ranked module. */
export interface AxRankedModule {
  namespace: string;
  /** Score normalized to 0..1 relative to the top match (top is always 1). */
  score: number;
  /** Query terms that matched this module (for telemetry/debugging). */
  matchedTerms: string[];
}

export interface AxRankModulesOptions {
  /** Max modules to return. Default 3. */
  topK?: number;
  /** Absolute floor on the top match's coverage (0..1). Default 0.08. */
  minScore?: number;
  /** Discrimination guard ratio. Default 0.15. */
  marginRatio?: number;
}

/** selectionCriteria is the human-authored routing signal — weight it higher. */
const SELECTION_CRITERIA_WEIGHT = 2;

function moduleToDocument(m: AxModuleRankInput): AxRankableDocument {
  const fields: AxRankableField[] = [{ text: m.namespace, identifier: true }];
  if (m.title) fields.push({ text: m.title });
  if (m.description) fields.push({ text: m.description });
  if (m.selectionCriteria) {
    fields.push({
      text: m.selectionCriteria,
      weight: SELECTION_CRITERIA_WEIGHT,
    });
  }
  for (const fn of m.functionNames ?? []) {
    fields.push({ text: fn, identifier: true });
  }
  for (const arg of m.argNames ?? []) {
    fields.push({ text: arg, identifier: true });
  }
  return { id: m.namespace, fields };
}

/**
 * Rank modules against a task. Returns an advisory shortlist (most relevant
 * first), or `[]` when the ranker has no confident signal — the caller must
 * treat `[]` as "show no hint".
 */
export function rankModules(
  task: string,
  modules: readonly AxModuleRankInput[],
  opts?: AxRankModulesOptions
): AxRankedModule[] {
  return rankDocuments(task, modules.map(moduleToDocument), opts).map((r) => ({
    namespace: r.id,
    score: r.score,
    matchedTerms: r.matchedTerms,
  }));
}

/** Minimal shape of a registered agent function needed for ranking. */
interface RankableFunction {
  name: string;
  namespace?: string;
  parameters?: { properties?: Record<string, unknown> };
  _alwaysInclude?: boolean;
}

/** Minimal shape of the per-namespace module metadata needed for ranking. */
interface RankableModuleMeta {
  title?: string;
  selectionCriteria?: string;
  description?: string;
}

/**
 * Flatten an agent's registered functions + module metadata into the ranker's
 * per-module input, matching the discoverable set the prompt lists (functions
 * flagged `_alwaysInclude` are inlined, not discoverable, so they're skipped).
 */
export function buildModuleRankInputs(
  agentFunctions: readonly RankableFunction[],
  moduleMetadata: ReadonlyMap<string, RankableModuleMeta>
): AxModuleRankInput[] {
  const byNamespace = new Map<
    string,
    { functionNames: string[]; argNames: Set<string> }
  >();
  for (const fn of agentFunctions) {
    if (fn._alwaysInclude === true) continue;
    const namespace = fn.namespace ?? 'utils';
    let bucket = byNamespace.get(namespace);
    if (!bucket) {
      bucket = { functionNames: [], argNames: new Set() };
      byNamespace.set(namespace, bucket);
    }
    bucket.functionNames.push(fn.name);
    for (const argName of Object.keys(fn.parameters?.properties ?? {})) {
      bucket.argNames.add(argName);
    }
  }
  return [...byNamespace.entries()].map(([namespace, bucket]) => {
    const meta = moduleMetadata.get(namespace);
    return {
      namespace,
      title: meta?.title,
      selectionCriteria: meta?.selectionCriteria,
      description: meta?.description,
      functionNames: bucket.functionNames,
      argNames: [...bucket.argNames],
    };
  });
}

// ----- Hint rendering (all domains) -----

/** Per-domain shortlists for the advisory `relevanceHints` prompt field. */
export interface AxRelevanceHints {
  modules?: readonly { namespace: string }[];
  skills?: readonly { id: string; name: string }[];
  memories?: readonly { id: string; snippet?: string }[];
}

/**
 * Render the advisory shortlists as markdown for the executor prompt hint.
 * Returns `undefined` when every domain is empty so the caller can omit the
 * field entirely (which makes the `### Likely Relevant` section vanish).
 */
export function renderRelevanceHintsMarkdown(
  hints: Readonly<AxRelevanceHints>
): string | undefined {
  const sections: string[] = [];
  if (hints.modules && hints.modules.length > 0) {
    sections.push(
      `Modules:\n${hints.modules.map((m) => `- \`${m.namespace}\``).join('\n')}`
    );
  }
  if (hints.skills && hints.skills.length > 0) {
    sections.push(
      `Skills:\n${hints.skills
        .map((s) => `- \`${s.id}\` — ${s.name}`)
        .join('\n')}`
    );
  }
  if (hints.memories && hints.memories.length > 0) {
    sections.push(
      `Memories:\n${hints.memories
        .map((m) => `- \`${m.id}\`${m.snippet ? ` — ${m.snippet}` : ''}`)
        .join('\n')}`
    );
  }
  if (sections.length === 0) return undefined;
  return sections.join('\n');
}
