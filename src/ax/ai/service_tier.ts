import type { AxAppliedServiceTier, AxServiceTier } from './types.js';

export type AxServiceTierMap = Readonly<
  Partial<Record<AxServiceTier, string | null>>
>;

const legacyTierAliases: Readonly<Record<string, AxServiceTier>> = {
  default: 'standard',
  on_demand: 'standard',
  standard_only: 'standard',
  performance: 'priority',
};

export const axNormalizeRequestedServiceTier = (
  value: unknown
): AxServiceTier | undefined => {
  if (typeof value !== 'string') return undefined;
  if (
    value === 'auto' ||
    value === 'standard' ||
    value === 'flex' ||
    value === 'priority'
  ) {
    return value;
  }
  return legacyTierAliases[value];
};

export const axNormalizeAppliedServiceTier = (
  value: unknown
): AxAppliedServiceTier | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.toLowerCase();
  if (normalized === 'batch') return 'batch';
  if (normalized === 'flex') return 'flex';
  if (normalized === 'priority' || normalized === 'performance') {
    return 'priority';
  }
  if (
    normalized === 'standard' ||
    normalized === 'default' ||
    normalized === 'on_demand' ||
    normalized === 'standard_only' ||
    normalized === 'unspecified'
  ) {
    return 'standard';
  }
  return undefined;
};

export const axResolveServiceTier = ({
  requested,
  fallback,
  supported,
  mapping,
  provider,
  model,
}: Readonly<{
  requested?: unknown;
  fallback?: unknown;
  supported?: readonly AxServiceTier[];
  mapping?: AxServiceTierMap;
  provider: string;
  model: string;
}>): string | undefined => {
  const tier =
    axNormalizeRequestedServiceTier(requested) ??
    axNormalizeRequestedServiceTier(fallback);
  if (!tier) return undefined;

  if (tier !== 'auto' && !supported?.includes(tier)) {
    const available = supported?.filter((item) => item !== 'auto') ?? [];
    throw new Error(
      `Service tier "${tier}" is not verified for ${provider} model ${model}` +
        (available.length > 0
          ? `; supported tiers: ${available.join(', ')}`
          : '; this provider/model has no portable service-tier support')
    );
  }

  const mapped = mapping?.[tier];
  if (mapped === null) return undefined;
  if (mapped !== undefined) return mapped;
  if (tier === 'auto') return undefined;
  return tier;
};
