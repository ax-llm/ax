import type { ZodTypeAny } from 'zod';

import type { AxField } from '../dsp/sig.js';

export type AxZodParsingMode = 'parse' | 'safeParse' | 'coerce';

export type AxZodAssertionLevel = 'none' | 'final' | 'streaming' | 'both';

export interface AxZodSignatureOptions {
  /** Throw when unsupported constructs are downgraded */
  readonly strict?: boolean;
  /** Generate validators compatible with streaming pipelines */
  readonly streaming?: boolean;
  /** Parsing mode used when wiring Zod assertions */
  readonly mode?: AxZodParsingMode;
  /** Controls when assertions run */
  readonly assertionLevel?: AxZodAssertionLevel;
  /** Optional input field definitions for the generated signature */
  readonly inputs?: readonly AxField[];
}

export type AxZodIssueSeverity = 'info' | 'warning' | 'error';

export interface AxZodConversionIssue {
  readonly path: string;
  readonly message: string;
  readonly severity: AxZodIssueSeverity;
  readonly kind: 'downgrade' | 'unsupported' | 'validation';
}

export interface AxZodMetadata {
  readonly schema: ZodTypeAny;
  readonly options: Required<
    Omit<AxZodSignatureOptions, 'strict' | 'streaming'>
  > & {
    readonly strict: boolean;
    readonly streaming: boolean;
  };
  readonly issues: readonly AxZodConversionIssue[];
  /** Ordered list of output field names derived from the schema */
  readonly fieldNames: readonly string[];
}
