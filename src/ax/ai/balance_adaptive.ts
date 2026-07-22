import type { AxAIService, AxAIServiceOptions, AxTokenUsage } from './types.js';

const STATS_VERSION = 1 as const;
const FAILURE_EWMA_ALPHA = 0.2;
const INITIAL_FAILURE_PROBABILITY = 0.05;
const MIN_LATENCY_MS = 1;
const LOG_TWO = Math.log(2);

/**
 * Expected token counts used to compare route costs before a request runs.
 * Omitted prompt or completion counts are treated as zero.
 */
export type AxBalancerExpectedTokens = Readonly<
  Partial<Pick<AxTokenUsage, 'promptTokens' | 'completionTokens'>>
>;

/** Stable address for one adaptive route's learned statistics. */
export type AxBalancerStatsKey = Readonly<{
  /** Application-level partition for independently deployed routing policies. */
  namespace: string;
  /** Request-level partition, such as workflow or traffic class. */
  slice: string;
  /** Model alias requested from the balancer. */
  logicalModel: string;
  /** Stable provider route identity supplied by the application. */
  routeKey: string;
}>;

/**
 * Versioned route state used by adaptive balancing.
 *
 * Successful latency is stored in log space using Welford's online mean and
 * M2. The balancer combines those values with a Normal-Inverse-Gamma prior at
 * selection time.
 */
export type AxBalancerRouteStats = Readonly<{
  /** Serialized state format version. */
  version: 1;
  /** Total successful and failed observations. */
  observations: number;
  /** Successful observations included in the latency model. */
  successes: number;
  /** Exponentially weighted probability of a transient provider failure. */
  failureEwma: number;
  /** Online mean of the natural logarithm of successful latency. */
  logLatencyMean: number;
  /** Welford M2 accumulator for natural-log successful latency. */
  logLatencyM2: number;
}>;

/** One provider-health observation recorded after an adaptive attempt. */
export type AxBalancerStatsObservation =
  | Readonly<{ outcome: 'success'; latencyMs: number }>
  | Readonly<{ outcome: 'failure' }>;

/**
 * Storage contract for adaptive routing state.
 *
 * `observe` must update a key atomically. Remote implementations can use
 * {@link axUpdateBalancerRouteStats} inside a transaction or server-side
 * script. Store failures are isolated from model requests by `AxBalancer`.
 */
export interface AxBalancerStatsStore {
  /** Read the latest route state, or return `undefined` for a cold route. */
  get(key: AxBalancerStatsKey): Promise<AxBalancerRouteStats | undefined>;
  /** Atomically reduce one observation into the state stored at `key`. */
  observe(
    key: AxBalancerStatsKey,
    observation: AxBalancerStatsObservation
  ): Promise<void>;
}

/** Public, prompt-free context supplied to adaptive routing callbacks. */
export type AxBalancerRoutingContext<TModelKey = string> = Readonly<{
  /** Logical model alias on the chat request. */
  model: TModelKey | undefined;
  /** Prompt-free service options associated with the request. */
  options: Readonly<AxAIServiceOptions> | undefined;
}>;

/** Context supplied when overriding a route's estimated request cost. */
export type AxBalancerCostContext<TModelKey = string> = Readonly<{
  /** Candidate service whose request cost is being estimated. */
  service: AxAIService<unknown, unknown, TModelKey>;
  /** Stable position of the service in the balancer's original input list. */
  serviceIndex: number;
  /** Stable route identity used by the adaptive stats store. */
  routeKey: string;
  /** Logical model alias requested from the balancer. */
  logicalModel: string;
  /** Concrete provider model selected by the service's model mapping. */
  resolvedModel: string;
  /** Optional pre-request token estimate configured on the strategy. */
  expectedTokens: AxBalancerExpectedTokens | undefined;
}>;

/** Sanitized candidate score exposed by the routing event hook. */
export type AxBalancerCandidateScore = Readonly<{
  /** Stable route identity used by the stats store. */
  routeKey: string;
  /** Public service name returned by the candidate. */
  serviceName: string;
  /** Final value used to rank this candidate; lower is better. */
  score: number;
  /** Pre-request cost estimate in the strategy's chosen currency or unit. */
  estimatedCost: number;
  /** Learned EWMA probability of a transient provider failure. */
  failureProbability: number;
  /** Sampled probability that a successful response misses the deadline. */
  deadlineMissProbability: number;
}>;

/** Classification of a transient provider failure used for failover. */
export type AxBalancerFailureReason =
  | 'status'
  | 'network'
  | 'response'
  | 'stream-terminated'
  | 'timeout';

/**
 * Prompt-free adaptive routing telemetry.
 *
 * Events intentionally contain no chat request, response, or raw provider
 * error. Callback failures never affect routing.
 */
export type AxBalancerRoutingEvent = Readonly<{
  /** Application namespace used by the stats key. */
  namespace: string;
  /** Request partition used by the stats key. */
  slice: string;
  /** Logical model alias requested from the balancer. */
  logicalModel: string;
}> &
  (
    | Readonly<{
        /** Candidate ranking was computed once for this request. */
        type: 'ranked';
        /** Candidates in attempt order with prompt-free score components. */
        candidates: readonly AxBalancerCandidateScore[];
      }>
    | Readonly<{
        /** One candidate was selected for an attempt. */
        type: 'selected';
        routeKey: string;
        serviceName: string;
        /** One-based position in this request's ranked attempt sequence. */
        attempt: number;
      }>
    | Readonly<{
        /** A transient provider failure caused failover to the next route. */
        type: 'fallback';
        fromRouteKey: string;
        toRouteKey: string | undefined;
        reason: AxBalancerFailureReason;
        status: number | undefined;
      }>
    | Readonly<{
        /** A success or eligible transient failure was sent to the store. */
        type: 'observation';
        routeKey: string;
        serviceName: string;
        outcome: AxBalancerStatsObservation['outcome'];
        latencyMs: number | undefined;
        streaming: boolean;
        reason: AxBalancerFailureReason | undefined;
        status: number | undefined;
      }>
    | Readonly<{
        /** A best-effort stats-store operation failed. */
        type: 'store-error';
        operation: 'get' | 'observe';
        routeKey: string;
        errorType: string;
      }>
  );

/** Opt-in adaptive provider-routing strategy for {@link AxBalancer}. */
export type AxBalancerAdaptiveStrategy<TModelKey = string> = Readonly<{
  /** Selects adaptive routing while leaving the default strategy unchanged. */
  type: 'adaptive';
  /** Target response latency in milliseconds; streaming uses first-chunk latency. */
  deadlineMs: number;
  /**
   * Cost assigned to a provider failure or deadline miss, in the same currency
   * or unit returned by `estimateCost` or the service pricing catalog.
   */
  badOutcomeCost: number;
  /** Expected tokens used with each service's built-in model pricing. */
  expectedTokens?: AxBalancerExpectedTokens;
  /** Override route pricing. Values must be finite and non-negative. */
  estimateCost?: (context: AxBalancerCostContext<TModelKey>) => number;
  /** Namespace used to isolate applications sharing a stats store. @default "default" */
  namespace?: string;
  /** Prompt-free application partition such as a workflow or tenant class. */
  slice?: (context: AxBalancerRoutingContext<TModelKey>) => string;
  /**
   * Stable route identity. Required when `statsStore` is supplied. The index
   * is the service's position in the balancer's original input list.
   */
  routeKey?: (
    service: AxAIService<unknown, unknown, TModelKey>,
    serviceIndex: number
  ) => string;
  /** Shared decision-state store. Defaults to one in-memory store per balancer. */
  statsStore?: AxBalancerStatsStore;
  /** Best-effort prompt-free telemetry hook. */
  onRoutingEvent?: (event: AxBalancerRoutingEvent) => void | Promise<void>;
}>;

/** Create the neutral prior state used for a route with no observations. */
export function createBalancerRouteStats(): AxBalancerRouteStats {
  return {
    version: STATS_VERSION,
    observations: 0,
    successes: 0,
    failureEwma: INITIAL_FAILURE_PROBABILITY,
    logLatencyMean: 0,
    logLatencyM2: 0,
  };
}

/**
 * Pure reducer for an adaptive route observation.
 *
 * External stores should apply this update atomically for each stats key.
 */
export function axUpdateBalancerRouteStats(
  current: AxBalancerRouteStats | undefined,
  observation: AxBalancerStatsObservation
): AxBalancerRouteStats {
  const stats = current ?? createBalancerRouteStats();
  const failed = observation.outcome === 'failure' ? 1 : 0;
  const failureEwma =
    FAILURE_EWMA_ALPHA * failed + (1 - FAILURE_EWMA_ALPHA) * stats.failureEwma;

  if (observation.outcome === 'failure') {
    return {
      ...stats,
      observations: stats.observations + 1,
      failureEwma,
    };
  }

  const logLatency = Math.log(Math.max(MIN_LATENCY_MS, observation.latencyMs));
  const successes = stats.successes + 1;
  const delta = logLatency - stats.logLatencyMean;
  const logLatencyMean = stats.logLatencyMean + delta / Math.max(1, successes);
  const deltaAfterMean = logLatency - logLatencyMean;

  return {
    ...stats,
    observations: stats.observations + 1,
    successes,
    failureEwma,
    logLatencyMean,
    logLatencyM2: stats.logLatencyM2 + delta * deltaAfterMean,
  };
}

/** Browser-compatible in-memory adaptive routing store. */
export class AxInMemoryBalancerStatsStore implements AxBalancerStatsStore {
  private readonly stats = new Map<string, AxBalancerRouteStats>();

  async get(
    key: AxBalancerStatsKey
  ): Promise<AxBalancerRouteStats | undefined> {
    const value = this.stats.get(serializeStatsKey(key));
    return value ? { ...value } : undefined;
  }

  async observe(
    key: AxBalancerStatsKey,
    observation: AxBalancerStatsObservation
  ): Promise<void> {
    const serializedKey = serializeStatsKey(key);
    this.stats.set(
      serializedKey,
      axUpdateBalancerRouteStats(this.stats.get(serializedKey), observation)
    );
  }
}

type AxBalancerSampledHealth = Readonly<{
  failureProbability: number;
  deadlineMissProbability: number;
}>;

export function sampleBalancerRouteHealth(
  stats: AxBalancerRouteStats | undefined,
  deadlineMs: number,
  random: () => number = Math.random
): AxBalancerSampledHealth {
  const current = stats ?? createBalancerRouteStats();
  const priorMean = Math.log(Math.max(MIN_LATENCY_MS, deadlineMs / 2));
  const priorStrength = 1;
  const priorAlpha = 2;
  const priorBeta = LOG_TWO ** 2;
  const count = current.successes;
  const posteriorStrength = priorStrength + count;
  const posteriorMean =
    (priorStrength * priorMean + count * current.logLatencyMean) /
    posteriorStrength;
  const posteriorAlpha = priorAlpha + count / 2;
  const meanDelta = current.logLatencyMean - priorMean;
  const posteriorBeta =
    priorBeta +
    current.logLatencyM2 / 2 +
    (priorStrength * count * meanDelta ** 2) / (2 * posteriorStrength);

  const precision = sampleGamma(
    posteriorAlpha,
    1 / Math.max(Number.EPSILON, posteriorBeta),
    random
  );
  const variance = 1 / Math.max(Number.EPSILON, precision);
  const sampledMean =
    posteriorMean +
    sampleStandardNormal(random) * Math.sqrt(variance / posteriorStrength);
  const z =
    (Math.log(Math.max(MIN_LATENCY_MS, deadlineMs)) - sampledMean) /
    Math.sqrt(variance);

  return {
    failureProbability: clampProbability(current.failureEwma),
    deadlineMissProbability: clampProbability(1 - normalCdf(z)),
  };
}

function serializeStatsKey(key: AxBalancerStatsKey): string {
  return JSON.stringify([
    key.namespace,
    key.slice,
    key.logicalModel,
    key.routeKey,
  ]);
}

function sampleGamma(
  shape: number,
  scale: number,
  random: () => number
): number {
  if (shape < 1) {
    const u = nonZeroRandom(random);
    return sampleGamma(shape + 1, scale, random) * u ** (1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    const x = sampleStandardNormal(random);
    const base = 1 + c * x;
    if (base <= 0) continue;
    const value = base ** 3;
    const u = nonZeroRandom(random);
    if (
      u < 1 - 0.0331 * x ** 4 ||
      Math.log(u) < 0.5 * x ** 2 + d * (1 - value + Math.log(value))
    ) {
      return d * value * scale;
    }
  }
}

function sampleStandardNormal(random: () => number): number {
  const u1 = nonZeroRandom(random);
  const u2 = nonZeroRandom(random);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function nonZeroRandom(random: () => number): number {
  return Math.min(1 - Number.EPSILON, Math.max(Number.EPSILON, random()));
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
    t;
  const erf = sign * (1 - polynomial * Math.exp(-x * x));
  return (1 + erf) / 2;
}

function clampProbability(value: number): number {
  return Math.min(1, Math.max(0, value));
}
