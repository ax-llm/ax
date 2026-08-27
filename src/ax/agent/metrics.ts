import type { Counter, Histogram, Meter } from '@opentelemetry/api';

export type AxAgentMetricsInstruments = Readonly<{
  requests: Counter;
  errors: Counter;
  duration: Histogram;
}>;

const instrumentsByMeter = new WeakMap<Meter, AxAgentMetricsInstruments>();

export function getOrCreateAgentMetricsInstruments(
  meter: Meter | undefined
): AxAgentMetricsInstruments | undefined {
  if (!meter) return undefined;
  const cached = instrumentsByMeter.get(meter);
  if (cached) return cached;
  try {
    const instruments = {
      requests: meter.createCounter('ax_gen_agent_requests_total'),
      errors: meter.createCounter('ax_gen_agent_errors_total'),
      duration: meter.createHistogram('ax_gen_agent_duration_ms', {
        unit: 'ms',
      }),
    } satisfies AxAgentMetricsInstruments;
    instrumentsByMeter.set(meter, instruments);
    return instruments;
  } catch {
    return undefined;
  }
}

export function recordAgentMetric(
  instrument: Counter | Histogram | undefined,
  value: number,
  attributes: Record<string, string | number | boolean>
): void {
  if (!instrument) return;
  try {
    if ('add' in instrument) instrument.add(value, attributes);
    else instrument.record(value, attributes);
  } catch {
    // External telemetry must never fail the agent.
  }
}
