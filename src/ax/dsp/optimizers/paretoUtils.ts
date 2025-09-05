// Shared Pareto / multi-objective helpers for GEPA optimizers

export function dominatesVector(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let atLeastAsGood = true;
  let strictlyBetter = false;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (va < vb) {
      atLeastAsGood = false;
      break;
    }
    if (va > vb) strictlyBetter = true;
  }
  return atLeastAsGood && strictlyBetter;
}

export function dominatesVectorEps(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
  eps = 0
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let atLeastAsGood = true;
  let strictlyBetter = false;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    if (va + eps < vb) {
      atLeastAsGood = false;
      break;
    }
    if (va > vb + eps) strictlyBetter = true;
  }
  return atLeastAsGood && strictlyBetter;
}

export function buildParetoFront(
  items: ReadonlyArray<{
    idx: number;
    scores: Readonly<Record<string, number>>;
  }>
): Array<{
  idx: number;
  scores: Readonly<Record<string, number>>;
  dominated: number;
}> {
  const front: Array<{
    idx: number;
    scores: Readonly<Record<string, number>>;
    dominated: number;
  }> = [];
  for (let i = 0; i < items.length; i++) {
    let dominatedCount = 0;
    let isDominated = false;
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      if (dominatesVector(items[j]!.scores, items[i]!.scores)) {
        isDominated = true;
        break;
      }
      if (dominatesVector(items[i]!.scores, items[j]!.scores)) dominatedCount++;
    }
    if (!isDominated)
      front.push({
        idx: items[i]!.idx,
        scores: items[i]!.scores,
        dominated: dominatedCount,
      });
  }
  return front;
}

export function computeCrowdingDistances(
  front: ReadonlyArray<{
    idx: number;
    scores: Readonly<Record<string, number>>;
  }>
): Map<number, number> {
  const dist = new Map<number, number>();
  if (front.length === 0) return dist;
  const keys = new Set<string>();
  for (const f of front) for (const k of Object.keys(f.scores)) keys.add(k);
  for (const f of front) dist.set(f.idx, 0);
  for (const key of keys) {
    const sorted = [...front].sort(
      (a, b) => (a.scores[key] ?? 0) - (b.scores[key] ?? 0)
    );
    const min = sorted[0] ? (sorted[0].scores[key] ?? 0) : 0;
    const max = sorted[sorted.length - 1]
      ? (sorted[sorted.length - 1].scores[key] ?? 0)
      : 0;
    const range = Math.max(max - min, 1e-9);
    if (sorted.length > 0) dist.set(sorted[0]!.idx, Number.POSITIVE_INFINITY);
    if (sorted.length > 1)
      dist.set(sorted[sorted.length - 1]!.idx, Number.POSITIVE_INFINITY);
    for (let i = 1; i < sorted.length - 1; i++) {
      const prev = sorted[i - 1]!.scores[key] ?? 0;
      const next = sorted[i + 1]!.scores[key] ?? 0;
      const inc = (next - prev) / range;
      dist.set(sorted[i]!.idx, (dist.get(sorted[i]!.idx) ?? 0) + inc);
    }
  }
  return dist;
}

export function hypervolume2D(
  front: ReadonlyArray<Readonly<Record<string, number>>>
): number | undefined {
  if (front.length === 0) return undefined;
  const keys = Object.keys(front[0] ?? {});
  if (keys.length !== 2) return undefined;
  const [k1, k2] = keys;
  const sorted = [...front].sort((a, b) => (b[k1!] ?? 0) - (a[k1!] ?? 0));
  let hv = 0;
  let prevY = 0;
  for (const p of sorted) {
    const x = p[k1!] ?? 0;
    const y = p[k2!] ?? 0;
    const dy = Math.max(y - prevY, 0);
    hv += x * dy;
    prevY = Math.max(prevY, y);
  }
  return hv;
}

export function weightedPick<T>(
  items: readonly T[],
  weights: readonly number[]
): T {
  const sum = weights.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (sum <= 0) return items[Math.floor(Math.random() * items.length)]!;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    const w = Number.isFinite(weights[i]!) ? (weights[i] as number) : 0;
    if (r < w) return items[i]!;
    r -= w;
  }
  return items[items.length - 1]!;
}

export function average(a: readonly number[]): number {
  if (a.length === 0) return 0;
  let s = 0;
  for (const v of a) s += v;
  return s / a.length;
}

export function randomSubset<T>(arr: readonly T[], k: number): T[] {
  if (k >= arr.length) return [...arr];
  const picked = new Set<number>();
  while (picked.size < k) picked.add(Math.floor(Math.random() * arr.length));
  return Array.from(picked).map((i) => arr[i]!);
}

export function selectCandidatePareto(S: number[][]): { index: number } {
  const nCand = S.length;
  const nInst = S[0]?.length ?? 0;
  if (nCand <= 1 || nInst === 0) return { index: 0 };

  const bestPerInst: number[] = new Array(nInst).fill(-Infinity);
  for (let i = 0; i < nInst; i++) {
    for (let k = 0; k < nCand; k++)
      bestPerInst[i] = Math.max(bestPerInst[i], S[k]![i]!);
  }

  const appears: number[] = new Array(nCand).fill(0);
  for (let i = 0; i < nInst; i++) {
    for (let k = 0; k < nCand; k++)
      if (S[k]![i]! === bestPerInst[i]) appears[k]! += 1;
  }

  const dominated = new Array(nCand).fill(false);
  for (let a = 0; a < nCand; a++) {
    for (let b = 0; b < nCand; b++) {
      if (a === b) continue;
      let allLe = true;
      let strictlyLt = false;
      for (let i = 0; i < nInst; i++) {
        if (S[a]![i]! > S[b]![i]!) allLe = false;
        if (S[b]![i]! > S[a]![i]!) strictlyLt = true;
        if (!allLe) break;
      }
      if (allLe && strictlyLt) {
        dominated[a] = true;
        break;
      }
    }
  }

  const weights: number[] = [];
  const indices: number[] = [];
  for (let k = 0; k < nCand; k++) {
    if (!dominated[k] && appears[k] > 0) {
      indices.push(k);
      weights.push(appears[k]);
    }
  }
  if (indices.length === 0) return { index: Math.floor(Math.random() * nCand) };

  const sumW = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * sumW;
  for (let j = 0; j < indices.length; j++) {
    if (r < weights[j]!) return { index: indices[j]! };
    r -= weights[j]!;
  }
  return { index: indices[indices.length - 1]! };
}

export function avgVec(
  arrs: ReadonlyArray<Record<string, number>>
): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const r of arrs) {
    for (const [k, v] of Object.entries(r)) {
      sums[k] = (sums[k] || 0) + (typeof v === 'number' ? v : 0);
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  const out: Record<string, number> = {};
  for (const [k, s] of Object.entries(sums))
    out[k] = s / Math.max(counts[k] || 1, 1);
  return out;
}

// ===== GEPA instance-front utilities (align with reference) =====

export function removeDominatedProgramsByInstanceFronts(
  fronts: ReadonlyArray<Readonly<Set<number>>>,
  scores: ReadonlyArray<number>
): Array<Set<number>> {
  // Gather all program indices present in any front
  const allPrograms = new Set<number>();
  for (const f of fronts) for (const p of f) allPrograms.add(p);
  const programs = Array.from(allPrograms);

  // Sort ascending by aggregate score (like reference)
  const sorted = [...programs].sort(
    (a, b) => (scores[a] ?? 0) - (scores[b] ?? 0)
  );

  const dominated = new Set<number>();

  const isDominated = (y: number, others: ReadonlySet<number>): boolean => {
    // y is dominated if for every front that contains y, there exists
    // at least one program from 'others' that is also in that front
    for (const front of fronts) {
      if (!front.has(y)) continue;
      let found = false;
      for (const o of others) {
        if (front.has(o)) {
          found = true;
          break;
        }
      }
      if (!found) return false; // in this front, no dominator present
    }
    return true;
  };

  let progress = true;
  while (progress) {
    progress = false;
    for (const y of sorted) {
      if (dominated.has(y)) continue;
      const others = new Set(
        sorted.filter((p) => p !== y && !dominated.has(p))
      );
      if (isDominated(y, others)) {
        dominated.add(y);
        progress = true;
        break;
      }
    }
  }

  const dominators = sorted.filter((p) => !dominated.has(p));
  const dominatorSet = new Set(dominators);

  // Filter each front to only include dominators
  return fronts.map((front) => {
    const nf = new Set<number>();
    for (const p of front) if (dominatorSet.has(p)) nf.add(p);
    return nf;
  });
}

export function selectProgramCandidateFromInstanceFronts(
  fronts: ReadonlyArray<Readonly<Set<number>>>,
  scores: ReadonlyArray<number>
): number {
  const reduced = removeDominatedProgramsByInstanceFronts(fronts, scores);
  const freq: Record<number, number> = {};
  for (const f of reduced) {
    for (const p of f) freq[p] = (freq[p] || 0) + 1;
  }
  const sampling: number[] = [];
  for (const [pStr, count] of Object.entries(freq)) {
    const p = Number(pStr);
    for (let k = 0; k < count; k++) sampling.push(p);
  }
  if (sampling.length === 0) return 0;
  const idx = Math.floor(Math.random() * sampling.length);
  return sampling[idx]!;
}
