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
      case 'object':
        return 'object';
      default:
        return 'string';
    }
  })();

  return type?.isArray ? `array of ${baseType}s` : baseType;
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }

  public getFixingInstructions = () => {
    return [
      {
        name: 'outputError',
        title: 'Invalid Field **Only return the invalid, remaining fields**',
        description: this.message,
      },
    ];
  };

  override toString(): string {
    return `${this.name}: ${this.message}`;
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

// Helper factories to create targeted ValidationErrors with actionable guidance
export const createMissingRequiredFieldsError = (
  fields: Readonly<AxField[]>
) => {
  const parts = fields.map((f) => `'${f.title}' (${toFieldType(f.type)})`);
  const list = parts.join(', ');
  return new ValidationError(
    `Required field not found: ${list}. Add a line starting with the exact label followed by a colon (e.g., "${fields[0]?.title}:") and then provide a valid ${toFieldType(fields[0]?.type)} value. Keep the output concise and avoid unrelated text.`
  );
};

export const createExpectedRequiredFieldNotFoundError = (
  field: Readonly<AxField>
) =>
  new ValidationError(
    `Expected (Required) field not found: '${field.title}'. Begin a new section with "${field.title}:" and then provide a valid ${toFieldType(field.type)} value directly after.`
  );

export const createExpectedFieldNotFoundError = (field: Readonly<AxField>) =>
  new ValidationError(
    `Expected field not found: '${field.title}'. Add the exact label "${field.title}:" and then provide a valid ${toFieldType(field.type)} value.`
  );

export const createRequiredFieldMissingError = (field: Readonly<AxField>) =>
  new ValidationError(
    `Required field is missing: '${field.title}'. After the "${field.title}:" label, provide a non-empty ${toFieldType(field.type)}. Do not use null, undefined, or leave it blank.`
  );

export const createInvalidJsonError = (
  field: Readonly<AxField>,
  detail: string
) =>
  new ValidationError(
    `Invalid JSON: ${detail} in field '${field.title}'. Return only valid JSON. Prefer a fenced code block containing a single JSON object or array with no trailing text.`
  );

export const createInvalidArrayError = (
  field: Readonly<AxField>,
  detail: string
) =>
  new ValidationError(
    `Invalid Array: ${detail} for '${field.title}'. Provide a JSON array of ${toFieldType(field.type)} items (e.g., [ ... ]). Markdown lists are also accepted if each item is on its own line starting with a hyphen.`
  );

export const createTypeValidationError = (
  field: Readonly<AxField>,
  fieldValue: string,
  detail: string
) =>
  new ValidationError(
    `Field '${field.title}' has an invalid value '${fieldValue}': ${detail}. Provide a ${toFieldType(field.type)}. Ensure formatting exactly matches the expected type.`
  );

export const createInvalidDateError = (
  field: Readonly<AxField>,
  dateStr: string,
  detail: string
) =>
  new ValidationError(
    `Invalid date for '${field.title}': ${detail}. Use the exact format YYYY-MM-DD (e.g., 2024-05-09). You provided: ${dateStr}.`
  );

export const createInvalidDateTimeError = (
  field: Readonly<AxField>,
  dateStr: string,
  detail: string
) =>
  new ValidationError(
    `Invalid date/time for '${field.title}': ${detail}. Use the format YYYY-MM-DD HH:mm or YYYY-MM-DD HH:mm:ss followed by a valid timezone (e.g., America/New_York). You provided: ${dateStr}.`
  );

export const createInvalidURLError = (
  field: Readonly<AxField>,
  urlStr: string,
  detail: string
) =>
  new ValidationError(
    `Invalid URL for '${field.title}': ${detail}. Use a valid URL format (e.g., https://example.com). You provided: ${urlStr}.`
  );

export const createStringConstraintError = (
  field: Readonly<AxField>,
  value: string,
  constraint: string,
  expected: number | string
) => {
  let message = `Field '${field.title}' failed validation: `;

  if (constraint === 'minLength') {
    message += `String must be at least ${expected} characters long. You provided: "${value}" (${value.length} characters).`;
  } else if (constraint === 'maxLength') {
    message += `String must be at most ${expected} characters long. You provided: "${value}" (${value.length} characters).`;
  } else if (constraint === 'pattern') {
    message += `String must match pattern /${expected}/. You provided: "${value}".`;
  } else if (constraint === 'format') {
    message += `String must be a ${expected}. You provided: "${value}".`;
  }

  return new ValidationError(message);
};

export const createNumberConstraintError = (
  field: Readonly<AxField>,
  value: number,
  constraint: string,
  expected: number
) => {
  let message = `Field '${field.title}' failed validation: `;

  if (constraint === 'minimum') {
    message += `Number must be at least ${expected}. You provided: ${value}.`;
  } else if (constraint === 'maximum') {
    message += `Number must be at most ${expected}. You provided: ${value}.`;
  }

  return new ValidationError(message);
};

export const createMissingToolArgumentsError = (
  toolName: string,
  missingFields: readonly AxField[]
) => {
  const fieldTitles = missingFields.map((field) => field.title);
  const fieldExamples = missingFields.map(
    (field) => `${field.name}: <${toFieldType(field.type)}>`
  );
  return new ValidationError(
    `Missing required fields for tool '${toolName}': ${fieldTitles.join(', ')}. Add lines with the exact labels followed by colons (e.g., "${fieldTitles[0]}:") and then provide valid values. Required fields: ${fieldExamples.join(', ')}.`
  );
};

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
