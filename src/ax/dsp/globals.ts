import type { Meter, Tracer } from '@opentelemetry/api';

import type { AxLoggerFunction } from '../ai/types.js';
import type { AxOptimizerLoggerFunction } from './optimizerTypes.js';

export type AxFunctionResultFormatter = (result: unknown) => string;

export const axGlobals = {
  signatureStrict: true, // Controls reservedNames enforcement in signature parsing/validation
  tracer: undefined as Tracer | undefined, // Global OpenTelemetry tracer for all AI operations
  meter: undefined as Meter | undefined, // Global OpenTelemetry meter for metrics collection
  logger: undefined as AxLoggerFunction | undefined, // Global logger for all AI operations
  optimizerLogger: undefined as AxOptimizerLoggerFunction | undefined, // Global optimizer logger for all optimizer operations
  debug: undefined as boolean | undefined, // Global debug setting for all AI operations
  functionResultFormatter: ((result: unknown) => {
    return typeof result === 'string'
      ? result
      : result === undefined || result === null
        ? ''
        : JSON.stringify(result, null, 2);
  }) as AxFunctionResultFormatter, // Global function result formatter
};
