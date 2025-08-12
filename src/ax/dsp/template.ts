import { AxGen } from './generate.js';
import { AxSignature } from './sig.js';
import type { ParseSignature } from './sigtypes.js';
import type { AxProgramForwardOptions } from './types.js';

// Function for string-based type-safe signature creation
export function s<const T extends string>(
  signature: T
): AxSignature<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']> {
  return AxSignature.create(signature);
}

// Function for type-safe generator creation - supports both strings and AxSignature objects
export function ax<
  const T extends string,
  ThoughtKey extends string = 'thought',
>(
  signature: T,
  options?: Readonly<
    AxProgramForwardOptions<any> & { thoughtFieldName?: ThoughtKey }
  >
): AxGen<
  ParseSignature<T>['inputs'],
  ParseSignature<T>['outputs'] &
    (string extends ThoughtKey
      ? { thought?: string }
      : { [P in ThoughtKey]?: string })
>;
export function ax<
  TInput extends Record<string, any>,
  TOutput extends Record<string, any>,
  ThoughtKey extends string = 'thought',
>(
  signature: AxSignature<TInput, TOutput>,
  options?: Readonly<
    AxProgramForwardOptions<any> & { thoughtFieldName?: ThoughtKey }
  >
): AxGen<
  TInput,
  TOutput &
    (string extends ThoughtKey
      ? { thought?: string }
      : { [P in ThoughtKey]?: string })
>;
export function ax<
  T extends string | AxSignature<any, any>,
  ThoughtKey extends string = 'thought',
  TInput extends Record<string, any> = T extends string
    ? ParseSignature<T>['inputs']
    : T extends AxSignature<infer I, any>
      ? I
      : never,
  TOutput extends Record<string, any> = T extends string
    ? ParseSignature<T>['outputs']
    : T extends AxSignature<any, infer O>
      ? O
      : never,
>(
  signature: T,
  options?: Readonly<
    AxProgramForwardOptions<any> & { thoughtFieldName?: ThoughtKey }
  >
): AxGen<
  TInput,
  TOutput &
    (string extends ThoughtKey
      ? { thought?: string }
      : { [P in ThoughtKey]?: string })
> {
  const typedSignature =
    typeof signature === 'string'
      ? AxSignature.create(signature)
      : (signature as AxSignature<TInput, TOutput>);
  return new AxGen<
    TInput,
    TOutput &
      (string extends ThoughtKey
        ? { thought?: string }
        : { [P in ThoughtKey]?: string })
  >(typedSignature, options as any);
}
