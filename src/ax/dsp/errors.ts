import type { Span } from '@opentelemetry/api';
import {
  logAssertionError,
  logRefusalError,
  logValidationError,
} from '../ai/debug.js';
import type { AxLoggerFunction } from '../ai/types.js';
import type { AxAIRefusalError } from '../util/apicall.js';
import type { AxAssertionError } from './asserts.js';
import type { AxGenMetricsInstruments } from './metrics.js';
import {
  recordRefusalErrorMetric,
  recordValidationErrorMetric,
} from './metrics.js';
import type { AxField } from './sig.js';

export class ValidationError extends Error {
  private fields: AxField[];

  constructor({
    message,
    fields,
  }: Readonly<{
    message: string;
    fields: AxField[];
    value?: string;
  }>) {
    super(message);
    this.fields = fields;
    this.name = this.constructor.name;
  }

  public getFixingInstructions = () => {
    const toFieldType = (type: Readonly<AxField['type']>) => {
      const baseType = (() => {
        switch (type?.name) {
          case 'string':
            return 'string';
          case 'number':
            return 'number';
          case 'boolean':
            return 'boolean';
          case 'date':
            return 'date ("YYYY-MM-DD" format)';
          case 'datetime':
            return 'date time ("YYYY-MM-DD HH:mm Timezone" format)';
          case 'json':
            return 'JSON object';
          case 'class':
            return 'classification class';
          case 'code':
            return 'code';
          default:
            return 'string';
        }
      })();

      return type?.isArray ? `json array of ${baseType} items` : baseType;
    };

    return this.fields.map((field) => ({
      name: 'outputError',
      title: 'Output Correction Required',
      description: `The section labeled '${field.title}' does not match the expected format of '${toFieldType(field.type)}'. ${this.message} Please revise your response to ensure it conforms to the specified format.`,
    }));
  };

  override toString(): string {
    const toFieldType = (type: Readonly<AxField['type']>) => {
      const baseType = (() => {
        switch (type?.name) {
          case 'string':
            return 'string';
          case 'number':
            return 'number';
          case 'boolean':
            return 'boolean';
          case 'date':
            return 'date ("YYYY-MM-DD" format)';
          case 'datetime':
            return 'date time ("YYYY-MM-DD HH:mm Timezone" format)';
          case 'json':
            return 'JSON object';
          case 'class':
            return 'classification class';
          case 'code':
            return 'code';
          default:
            return 'string';
        }
      })();

      return type?.isArray ? `json array of ${baseType} items` : baseType;
    };

    return [
      `${this.name}: ${this.message}`,
      ...this.fields.map(
        (field) =>
          `  - ${field.title}: Expected format '${toFieldType(field.type)}'`
      ),
    ].join('\n');
  }

  [Symbol.for('nodejs.util.inspect.custom')](
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _depth: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _options: Record<string, unknown>
  ) {
    return this.toString();
  }
}

export type HandleErrorForGenerateArgs<TError extends Error> = {
  error: TError;
  errCount: number;
  logger: AxLoggerFunction | undefined;
  metricsInstruments: AxGenMetricsInstruments | undefined;
  signatureName: string;
  span: Span | undefined;
  debug: boolean;
};

/**
 * Handles validation errors with logging, metrics, and telemetry
 */
export const handleValidationErrorForGenerate = ({
  error,
  errCount,
  debug,
  logger,
  metricsInstruments,
  signatureName,
  span,
}: HandleErrorForGenerateArgs<ValidationError>) => {
  const errorFields = error.getFixingInstructions();

  // Log validation error with proper structured logging
  if (debug && logger) {
    const fixingInstructions =
      errorFields?.map((f) => f.title).join(', ') ?? '';
    logValidationError(error, errCount, fixingInstructions, logger);
  }

  // Record validation error metric
  if (metricsInstruments) {
    recordValidationErrorMetric(
      metricsInstruments,
      'validation',
      signatureName
    );
  }

  // Add telemetry event for validation error
  if (span) {
    span.addEvent('validation.error', {
      message: error.toString(),
      fixing_instructions: errorFields?.map((f) => f.title).join(', ') ?? '',
    });
  }

  return errorFields;
};

/**
 * Handles assertion errors with logging, metrics, and telemetry
 */
export const handleAssertionErrorForGenerate = ({
  error,
  errCount,
  debug,
  logger,
  metricsInstruments,
  signatureName,
  span,
}: HandleErrorForGenerateArgs<AxAssertionError>) => {
  const errorFields = error.getFixingInstructions();

  // Log assertion error with proper structured logging
  if (debug && logger) {
    const fixingInstructions =
      errorFields?.map((f) => f.title).join(', ') ?? '';
    logAssertionError(error, errCount, fixingInstructions, logger);
  }

  // Record assertion error metric
  if (metricsInstruments) {
    recordValidationErrorMetric(metricsInstruments, 'assertion', signatureName);
  }

  // Add telemetry event for assertion error
  if (span) {
    span.addEvent('assertion.error', {
      message: error.toString(),
      fixing_instructions: errorFields?.map((f) => f.title).join(', ') ?? '',
    });
  }

  return errorFields;
};

/**
 * Handles refusal errors with logging, metrics, and telemetry
 */
export const handleRefusalErrorForGenerate = ({
  error,
  errCount,
  debug,
  logger,
  metricsInstruments,
  signatureName,
  span,
}: HandleErrorForGenerateArgs<AxAIRefusalError>) => {
  // Log refusal error with proper structured logging
  if (debug && logger) {
    logRefusalError(error, errCount, logger);
  }

  // Record refusal error metric
  if (metricsInstruments) {
    recordRefusalErrorMetric(metricsInstruments, signatureName);
  }

  // Add telemetry event for refusal error
  if (span) {
    span.addEvent('refusal.error', {
      message: error.toString(),
    });
  }
};
