import type { AxAIService } from '../ai/types.js';
import { AxGen } from '../dsp/generate.js';
import { f } from '../dsp/sig.js';
import type { AxProgramForwardOptions } from '../dsp/types.js';

const DEFAULT_CONTEXT_MAP_MAX_CHARS = 4_000;

const SECTIONS = [
  {
    name: 'context_roadmap',
    title: 'CONTEXT ROADMAP',
    slug: 'cr',
    description: 'Index of what the context contains and where to find it.',
  },
  {
    name: 'context_understanding',
    title: 'CONTEXT UNDERSTANDING',
    slug: 'cu',
    description:
      "High-level understanding of the context: what it is, how it's organized, and what matters.",
  },
  {
    name: 'domain_constants',
    title: 'DOMAIN CONSTANTS',
    slug: 'dc',
    description:
      'Exact parameters, formulas, thresholds, reference values, enum sets, and output field requirements defined by the context.',
  },
  {
    name: 'parsing_schema',
    title: 'PARSING SCHEMA',
    slug: 'ps',
    description: "How to parse and navigate the context's format.",
  },
  {
    name: 'reusable_results',
    title: 'REUSABLE RESULTS',
    slug: 'rr',
    description: 'Reusable knowledge about the context.',
  },
  {
    name: 'error_patterns',
    title: 'ERROR PATTERNS',
    slug: 'ep',
    description:
      'Concrete failure modes observed while processing this context.',
  },
] as const;

const SECTION_BY_NAME: ReadonlyMap<string, (typeof SECTIONS)[number]> = new Map(
  SECTIONS.map((section) => [section.name, section])
);
const SECTION_BY_TITLE: ReadonlyMap<string, (typeof SECTIONS)[number]> =
  new Map(
    SECTIONS.map((section) => [normalizeSectionName(section.title), section])
  );
const ITEM_RE = /^\[([^\]]+)]\s*(.*)$/;
const ID_TAIL_RE = /-(\d+)$/;

export type AxAgentContextMapSnapshot = {
  version: 1;
  text: string;
  scores?: Record<string, number>;
  steps?: number;
  maxChars?: number;
  infiniteEvolve?: boolean;
  evolveSteps?: number;
};

export type AxAgentContextMapOptions = {
  maxChars?: number;
  infiniteEvolve?: boolean;
  evolveSteps?: number;
};

export type AxAgentContextMapOperation =
  | {
      type: 'ADD';
      section: string;
      content: string;
    }
  | {
      type: 'DELETE';
      itemId: string;
    }
  | {
      type: 'REPLACE';
      itemId: string;
      content: string;
    };

export type AxAgentContextMapUpdateResult = {
  map: AxAgentContextMap;
  mapText: string;
  status: 'updated' | 'unchanged' | 'skipped';
  step: number;
  skipReason?: 'evolve_steps';
  diagnosis?: string;
  operations: AxAgentContextMapOperation[];
  changed: boolean;
};

export type AxAgentContextMapConfig = {
  map?: AxAgentContextMap | AxAgentContextMapSnapshot | string;
  onUpdate?: (result: AxAgentContextMapUpdateResult) => void | Promise<void>;
};

type ContextMapItem = {
  id: string;
  section: string;
  content: string;
};

type ContextMapUpdaterOutput = {
  diagnosis?: string;
  itemTags?: Record<string, unknown>;
  cacheCandidates?: unknown;
  operations?: unknown;
};

type ContextMapOptionsState = {
  maxChars: number;
  infiniteEvolve: boolean;
  evolveSteps?: number;
};

function initialContextMapText(): string {
  return `${SECTIONS.map(
    ({ title, description }) => `## ${title}\n(${description})`
  ).join('\n\n')}\n`;
}

function normalizeSectionName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_')
    .replace(/:$/g, '');
}

function sectionForName(name: string | undefined) {
  if (!name) {
    return undefined;
  }
  const normalized = normalizeSectionName(name);
  return SECTION_BY_NAME.get(normalized) ?? SECTION_BY_TITLE.get(normalized);
}

function normalizeText(text: string): string {
  const trimmed = text.trim();
  return `${trimmed.length > 0 ? trimmed : initialContextMapText().trim()}\n`;
}

function parseItems(text: string): ContextMapItem[] {
  const items: ContextMapItem[] = [];
  let section = 'context_understanding';
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (stripped.startsWith('##')) {
      const matched = sectionForName(stripped.replace(/^#+/, '').trim());
      if (matched) {
        section = matched.name;
      }
      continue;
    }
    const match = ITEM_RE.exec(stripped);
    if (match) {
      items.push({
        id: match[1] ?? '',
        section,
        content: (match[2] ?? '').trim(),
      });
    }
  }
  return items.filter((item) => item.id && item.content);
}

function nextItemNumber(items: readonly ContextMapItem[]): number {
  let max = 0;
  for (const item of items) {
    const match = ID_TAIL_RE.exec(item.id);
    if (match) {
      max = Math.max(max, Number.parseInt(match[1] ?? '0', 10));
    }
  }
  return max + 1;
}

function normalizeOperation(
  input: unknown
): AxAgentContextMapOperation | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const raw = input as Record<string, unknown>;
  const type =
    typeof raw.type === 'string' ? raw.type.trim().toUpperCase() : '';
  if (type === 'ADD') {
    const section = typeof raw.section === 'string' ? raw.section : '';
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    const normalizedSection = sectionForName(section);
    if (!normalizedSection || !content) {
      return undefined;
    }
    return { type: 'ADD', section: normalizedSection.name, content };
  }
  if (type === 'DELETE') {
    const itemId =
      typeof raw.itemId === 'string'
        ? raw.itemId.trim()
        : typeof raw.item_id === 'string'
          ? raw.item_id.trim()
          : '';
    return itemId ? { type: 'DELETE', itemId } : undefined;
  }
  if (type === 'REPLACE') {
    const itemId =
      typeof raw.itemId === 'string'
        ? raw.itemId.trim()
        : typeof raw.item_id === 'string'
          ? raw.item_id.trim()
          : '';
    const content = typeof raw.content === 'string' ? raw.content.trim() : '';
    return itemId && content ? { type: 'REPLACE', itemId, content } : undefined;
  }
  return undefined;
}

function normalizeOperations(input: unknown): AxAgentContextMapOperation[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => normalizeOperation(item))
    .filter((item): item is AxAgentContextMapOperation => Boolean(item));
}

function applyOperations(
  text: string,
  operations: readonly AxAgentContextMapOperation[]
): {
  text: string;
  applied: AxAgentContextMapOperation[];
} {
  if (operations.length === 0) {
    return { text, applied: [] };
  }

  const existingItems = parseItems(text);
  const existingIds = new Set(existingItems.map((item) => item.id));
  const deletes = new Set<string>();
  const replaces = new Map<string, string>();
  const adds: Array<{
    section: string;
    line: string;
    operation: AxAgentContextMapOperation;
  }> = [];
  const applied: AxAgentContextMapOperation[] = [];
  let next = nextItemNumber(existingItems);

  for (const operation of operations) {
    if (operation.type === 'DELETE') {
      if (!existingIds.has(operation.itemId)) {
        continue;
      }
      deletes.add(operation.itemId);
      applied.push(operation);
      continue;
    }
    if (operation.type === 'REPLACE') {
      if (!existingIds.has(operation.itemId)) {
        continue;
      }
      replaces.set(operation.itemId, operation.content);
      applied.push(operation);
      continue;
    }
    const section = sectionForName(operation.section);
    if (!section) {
      continue;
    }
    const itemId = `${section.slug}-${String(next).padStart(5, '0')}`;
    next++;
    adds.push({
      section: section.name,
      line: `[${itemId}] ${operation.content}`,
      operation,
    });
    applied.push(operation);
  }

  const lines = text.split('\n');
  const out: string[] = [];
  let currentSection: string | undefined;

  const flushAdds = (sectionName: string | undefined) => {
    if (!sectionName) {
      return;
    }
    const matching = adds.filter((item) => item.section === sectionName);
    if (matching.length === 0) {
      return;
    }
    out.push(...matching.map((item) => item.line));
    for (const item of matching) {
      const index = adds.indexOf(item);
      if (index >= 0) {
        adds.splice(index, 1);
      }
    }
  };

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped.startsWith('##')) {
      flushAdds(currentSection);
      if (out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }
      currentSection = sectionForName(stripped.replace(/^#+/, '').trim())?.name;
      out.push(line);
      continue;
    }
    const match = ITEM_RE.exec(stripped);
    if (match) {
      const itemId = match[1] ?? '';
      if (deletes.has(itemId)) {
        continue;
      }
      const replacement = replaces.get(itemId);
      if (replacement !== undefined) {
        out.push(`[${itemId}] ${replacement}`);
        continue;
      }
    }
    out.push(line);
  }

  flushAdds(currentSection);
  for (const section of SECTIONS) {
    const remaining = adds.filter((item) => item.section === section.name);
    if (remaining.length === 0) {
      continue;
    }
    if (out.length > 0 && out[out.length - 1] !== '') {
      out.push('');
    }
    out.push(`## ${section.title}`);
    out.push(...remaining.map((item) => item.line));
  }

  return { text: collapseBlankLines(out.join('\n')), applied };
}

function collapseBlankLines(text: string): string {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim() && out[out.length - 1] === '') {
      continue;
    }
    out.push(line);
  }
  return `${out.join('\n').trim()}\n`;
}

function updateScores(
  scores: Readonly<Record<string, number>>,
  tags: Record<string, unknown> | undefined,
  itemIds: ReadonlySet<string>
): Record<string, number> {
  const next = { ...scores };
  for (const [itemId, tag] of Object.entries(tags ?? {})) {
    if (!itemIds.has(itemId)) {
      continue;
    }
    if (typeof tag !== 'string') {
      continue;
    }
    const normalizedTag = tag.trim().toLowerCase();
    if (normalizedTag === 'helpful') {
      next[itemId] = (next[itemId] ?? 0) + 1;
    } else if (normalizedTag === 'harmful' || normalizedTag === 'stale') {
      next[itemId] = (next[itemId] ?? 0) - 1;
    } else if (normalizedTag === 'neutral') {
      next[itemId] = next[itemId] ?? 0;
    }
  }
  return next;
}

function removeItems(text: string, itemIds: ReadonlySet<string>): string {
  return collapseBlankLines(
    text
      .split('\n')
      .filter((line) => {
        const match = ITEM_RE.exec(line.trim());
        return !match || !itemIds.has(match[1] ?? '');
      })
      .join('\n')
  );
}

function evictToBudget(
  text: string,
  scores: Readonly<Record<string, number>>,
  maxChars: number
): string {
  if (text.length <= maxChars) {
    return text;
  }
  const items = parseItems(text);
  const ordered = [...items].sort((left, right) => {
    const scoreDiff = (scores[left.id] ?? 0) - (scores[right.id] ?? 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    const leftAge = Number.parseInt(ID_TAIL_RE.exec(left.id)?.[1] ?? '0', 10);
    const rightAge = Number.parseInt(ID_TAIL_RE.exec(right.id)?.[1] ?? '0', 10);
    return leftAge - rightAge;
  });
  const removed = new Set<string>();
  for (const item of ordered) {
    removed.add(item.id);
    const trial = removeItems(text, removed);
    if (trial.length <= maxChars) {
      return trial;
    }
  }
  return removeItems(text, removed);
}

function isSnapshot(value: unknown): value is AxAgentContextMapSnapshot {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

function normalizeContextMapOptions(
  options?: Readonly<AxAgentContextMapOptions>,
  snapshot?: Readonly<AxAgentContextMapSnapshot>
): ContextMapOptionsState {
  const maxChars =
    options?.maxChars ?? snapshot?.maxChars ?? DEFAULT_CONTEXT_MAP_MAX_CHARS;
  if (!Number.isInteger(maxChars) || maxChars <= 0) {
    throw new Error('AxAgentContextMap maxChars must be a positive integer.');
  }

  const infiniteEvolve =
    options?.infiniteEvolve ?? snapshot?.infiniteEvolve ?? true;
  const evolveSteps = options?.evolveSteps ?? snapshot?.evolveSteps;

  if (infiniteEvolve) {
    return {
      maxChars,
      infiniteEvolve,
    };
  }

  if (!Number.isInteger(evolveSteps) || (evolveSteps ?? -1) < 0) {
    throw new Error(
      'AxAgentContextMap requires a non-negative evolveSteps when infiniteEvolve is false.'
    );
  }
  return {
    maxChars,
    infiniteEvolve,
    evolveSteps: evolveSteps as number,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (value.length <= 1_000) {
      return value;
    }
    return `${value.slice(0, 700)}\n...[${value.length - 900} chars omitted]...\n${value.slice(-200)}`;
  }
  if (Array.isArray(value)) {
    if (depth >= 2) {
      return `[Array(${value.length})]`;
    }
    const head = value
      .slice(0, 5)
      .map((item) => summarizeValue(item, depth + 1));
    return value.length > 5
      ? [...head, `[${value.length - 5} more items]`]
      : head;
  }
  if (value && typeof value === 'object') {
    if (depth >= 2) {
      return '[Object]';
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>
    )) {
      out[key] = summarizeValue(item, depth + 1);
    }
    return out;
  }
  return value;
}

const CONTEXT_MAP_DISTILLER_PROMPT = `You are the context-map Distiller for a recurring external context used by an AxAgent RLM loop.

Your job is to read the completed trajectory and identify reusable orientation knowledge about the external context. The context map is a persistent cache of understanding, not a transcript summary, task playbook, or answer cache.

Separate the run into two kinds of work:
- Orientation work: learning what the context contains, how it is organized, which entities or concepts matter, which schemas/constants govern the data, and which processing results transfer across future questions.
- Question-specific work: locating the one passage, quote, record, or calculation needed only for this task.

Cache only orientation work. Use this litmus test for every candidate: would a future agent asking a completely different question about the same context benefit from knowing this?

Review every existing context-map item before proposing new knowledge. Tag each existing item ID as exactly one of helpful, harmful, neutral, or stale. Treat unused-but-correct domain knowledge as neutral, not harmful.

Prefer compact abstractions over raw excerpts, but preserve exact constants when the context defines them: numeric thresholds, formulas, enum sets, field names, output requirements, reference values, and parsing rules.

Do not cache advisory rules, behavioral instructions, raw dumps, verbose copied passages, naive one-off counts, or answers to the current task.

Return:
- diagnosis: concise analysis of orientation work vs. question-specific work, including what transferable understanding was gained or reused.
- itemTags: object mapping existing context-map item IDs to helpful, harmful, neutral, or stale.
- cacheCandidates: JSON array of objects with section, value, transferability, and rationale. Each candidate must be compact and must explain why it is shared context understanding rather than a one-off answer.`;

const CONTEXT_MAP_CARTOGRAPHER_PROMPT = `You are the context-map Cartographer for a recurring external context used by an AxAgent RLM loop.

Translate the Distiller reflection into a small set of concrete context-map edits. Maintain a concise, high-value context map that stores shared understanding of the external context, not answers to individual questions.

Use this shared-understanding litmus test for every edit: would a future agent asking a completely different question about this same context benefit from this item?

Value priority, highest to lowest:
1. Context understanding: key entities, concepts, roles, relationships, data categories, and global summaries that orient the agent.
2. Domain constants: exact thresholds, rates, formulas, conversion factors, enum sets, required field names, output schemas, and reference values. Keep these precise.
3. Context roadmap: document, section, table, or repository layout and where different topics can be found.
4. Reusable results: derived aggregates, classifications, inventories, or computations that multiple questions can reuse, with enough method detail to judge reliability.
5. Parsing schema: delimiters, record boundaries, field formats, extraction patterns, and navigation conventions.
6. Error patterns: concrete failure modes observed while processing the context.

Character budget triage: when the map is near or over budget, remove or rewrite low-value entries first: one-off facts, error patterns, parsing schema, roadmap items, reusable results, then protect domain constants and context understanding as much as possible.

Prefer REPLACE over ADD when an existing item can be made more correct, compact, or general. DELETE stale, misleading, redundant, low-value, verbose, or question-specific items. ADD only transferable context understanding.

Do not add raw data dumps, long excerpts, behavioral instructions, policy reminders, one-off answers, or facts that only resolve the latest task. If nothing is worth keeping, return an empty operations list.

Return operations as JSON objects:
- {"type":"ADD","section":"context_understanding","content":"..."}
- {"type":"DELETE","item_id":"cu-00001"}
- {"type":"REPLACE","item_id":"cu-00001","content":"..."}`;

const contextMapDistillerSignature = f()
  .input('task', f.string('The user task that was completed.'))
  .input('contextMap', f.string('The current context map.'))
  .input('trajectory', f.string('The agent trajectory and final result.'))
  .output(
    'diagnosis',
    f.string('Brief note about what reusable context was found.').optional()
  )
  .output(
    'itemTags',
    f
      .json(
        'Object mapping existing context-map item IDs to helpful, harmful, neutral, or stale.'
      )
      .optional()
  )
  .output(
    'cacheCandidates',
    f
      .json(
        'Array of compact candidate objects with section, value, transferability, and rationale.'
      )
      .optional()
  )
  .build();

const contextMapCartographerSignature = f()
  .input('task', f.string('The user task that was completed.'))
  .input('contextMap', f.string('The current context map.'))
  .input(
    'distillerReflection',
    f.string('The Distiller diagnosis, item tags, and cache candidates.')
  )
  .input('currentChars', f.number('Current context-map character count.'))
  .input('maxChars', f.number('Maximum context-map character budget.'))
  .output(
    'operations',
    f
      .json(
        'Array of ADD, DELETE, or REPLACE operations to apply to the context map. Use item_id for DELETE and REPLACE item IDs.'
      )
      .optional()
  )
  .build();

export class AxAgentContextMap {
  private maxChars: number;
  private infiniteEvolve: boolean;
  private evolveSteps?: number;
  private scores: Record<string, number> = {};
  private steps = 0;
  public text: string;

  constructor(
    input?: AxAgentContextMapSnapshot | string,
    options?: AxAgentContextMapOptions
  ) {
    const snapshot = isSnapshot(input) ? input : undefined;
    const normalizedOptions = normalizeContextMapOptions(options, snapshot);
    this.maxChars = normalizedOptions.maxChars;
    this.infiniteEvolve = normalizedOptions.infiniteEvolve;
    this.evolveSteps = normalizedOptions.evolveSteps;

    if (typeof input === 'string') {
      this.text = normalizeText(input);
    } else if (snapshot) {
      this.text = normalizeText(snapshot.text);
      this.scores = { ...(snapshot.scores ?? {}) };
      this.steps = snapshot.steps ?? 0;
    } else {
      this.text = initialContextMapText();
    }
  }

  public static fromSnapshot(
    snapshot: AxAgentContextMapSnapshot,
    options?: AxAgentContextMapOptions
  ): AxAgentContextMap {
    return new AxAgentContextMap(snapshot, options);
  }

  public static fromText(
    text: string,
    options?: AxAgentContextMapOptions
  ): AxAgentContextMap {
    return new AxAgentContextMap(text, options);
  }

  public snapshot(): AxAgentContextMapSnapshot {
    const snapshot: AxAgentContextMapSnapshot = {
      version: 1,
      text: this.text,
      scores: { ...this.scores },
      steps: this.steps,
      maxChars: this.maxChars,
      infiniteEvolve: this.infiniteEvolve,
    };
    if (this.evolveSteps !== undefined) {
      snapshot.evolveSteps = this.evolveSteps;
    }
    return snapshot;
  }

  public tag(itemId: string, tag: string): boolean {
    const itemIds = new Set(parseItems(this.text).map((item) => item.id));
    const before = this.scores[itemId];
    this.scores = updateScores(this.scores, { [itemId]: tag }, itemIds);
    return before !== this.scores[itemId];
  }

  private shouldEvolve(): boolean {
    return this.infiniteEvolve || this.steps < (this.evolveSteps ?? 0);
  }

  private skippedUpdateResult(): AxAgentContextMapUpdateResult {
    return {
      map: this,
      mapText: this.text,
      status: 'skipped',
      step: this.steps,
      skipReason: 'evolve_steps',
      operations: [],
      changed: false,
    };
  }

  public applyUpdatePayload(
    payload: ContextMapUpdaterOutput
  ): AxAgentContextMapUpdateResult {
    const before = this.text;
    const itemsBefore = parseItems(this.text);
    const itemIds = new Set(itemsBefore.map((item) => item.id));
    this.scores = updateScores(this.scores, payload.itemTags, itemIds);

    const normalizedOperations = normalizeOperations(payload.operations);
    const { text, applied } = applyOperations(this.text, normalizedOperations);
    this.text = evictToBudget(text, this.scores, this.maxChars);
    this.steps++;
    const changed = before !== this.text;

    return {
      map: this,
      mapText: this.text,
      status: changed ? 'updated' : 'unchanged',
      step: this.steps,
      diagnosis: payload.diagnosis,
      operations: applied,
      changed,
    };
  }

  public async update(
    ai: Readonly<AxAIService>,
    args: Readonly<{
      task: string;
      trajectory: string;
      options?: Readonly<Omit<AxProgramForwardOptions<string>, 'functions'>>;
    }>
  ): Promise<AxAgentContextMapUpdateResult> {
    if (!this.shouldEvolve()) {
      return this.skippedUpdateResult();
    }

    const distiller = new AxGen(contextMapDistillerSignature, {
      ...(args.options ?? {}),
      description: CONTEXT_MAP_DISTILLER_PROMPT,
    });
    const distillerOutput = (await distiller.forward(ai, {
      task: args.task,
      contextMap: this.text,
      trajectory: args.trajectory,
    })) as ContextMapUpdaterOutput;

    const cartographer = new AxGen(contextMapCartographerSignature, {
      ...(args.options ?? {}),
      description: CONTEXT_MAP_CARTOGRAPHER_PROMPT,
    });
    const cartographerOutput = (await cartographer.forward(ai, {
      task: args.task,
      contextMap: this.text,
      distillerReflection: safeStringify(distillerOutput),
      currentChars: this.text.length,
      maxChars: this.maxChars,
    })) as Pick<ContextMapUpdaterOutput, 'operations'>;

    return this.applyUpdatePayload({
      diagnosis: distillerOutput.diagnosis,
      itemTags: distillerOutput.itemTags,
      cacheCandidates: distillerOutput.cacheCandidates,
      operations: cartographerOutput.operations,
    });
  }
}

export function normalizeAgentContextMap(
  config: AxAgentContextMapConfig | undefined
): AxAgentContextMap | undefined {
  if (!config) {
    return undefined;
  }
  const map = config.map;
  if (map instanceof AxAgentContextMap) {
    return map;
  }
  if (typeof map === 'string' || isSnapshot(map)) {
    return new AxAgentContextMap(map);
  }
  return new AxAgentContextMap();
}

export function formatContextMapTrajectory(
  args: Readonly<{
    values: unknown;
    distillerActionLog?: string;
    executorActionLog?: string;
    executorResult?: unknown;
    finalOutput?: unknown;
  }>
): string {
  return [
    '## Input Summary',
    safeStringify(summarizeValue(args.values)),
    '## Distiller Action Log',
    args.distillerActionLog?.trim() || '(none)',
    '## Executor Action Log',
    args.executorActionLog?.trim() || '(none)',
    '## Executor Result',
    safeStringify(args.executorResult),
    '## Final Output',
    safeStringify(args.finalOutput),
  ].join('\n\n');
}
