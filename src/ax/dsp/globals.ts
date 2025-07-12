import type { Meter, Tracer } from '@opentelemetry/api';

export type AxFunctionResultFormatter = (result: unknown) => string;

export const axGlobals = {
  signatureStrict: true, // Controls reservedNames enforcement in signature parsing/validation
  tracer: undefined as Tracer | undefined, // Global OpenTelemetry tracer for all AI operations
  meter: undefined as Meter | undefined, // Global OpenTelemetry meter for metrics collection
  functionResultFormatter: ((result: unknown) => {
    return typeof result === 'string'
      ? result
      : result === undefined || result === null
        ? ''
        : JSON.stringify(result, null, 2);
  }) as AxFunctionResultFormatter, // Global function result formatter
};
