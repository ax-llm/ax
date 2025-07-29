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

// Function for string-based type-safe generator creation
export function ax<const T extends string>(
  signature: T,
  options?: Readonly<AxProgramForwardOptions<any>>
): AxGen<ParseSignature<T>['inputs'], ParseSignature<T>['outputs']> {
  const typedSignature = AxSignature.create(signature);
  return new AxGen(typedSignature, options);
}
