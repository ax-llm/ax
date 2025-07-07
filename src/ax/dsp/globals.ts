import type { Meter, Tracer } from '@opentelemetry/api'

export const axGlobals = {
  signatureStrict: true, // Controls reservedNames enforcement in signature parsing/validation
  tracer: undefined as Tracer | undefined, // Global OpenTelemetry tracer for all AI operations
  meter: undefined as Meter | undefined, // Global OpenTelemetry meter for metrics collection
}
