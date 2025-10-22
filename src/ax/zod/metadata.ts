import type { AxSignature } from '../dsp/sig.js';

import type { AxZodMetadata } from './types.js';

const metadataStore = new WeakMap<object, AxZodMetadata>();

export const AxZodRegistry = {
  register(signature: AxSignature, meta: AxZodMetadata): void {
    metadataStore.set(signature as unknown as object, meta);
  },
  get(signature: AxSignature): AxZodMetadata | undefined {
    return metadataStore.get(signature as unknown as object);
  },
  has(signature: AxSignature): boolean {
    return metadataStore.has(signature as unknown as object);
  },
} as const;

export const setZodMetadata = (
  signature: AxSignature,
  meta: AxZodMetadata
): void => {
  AxZodRegistry.register(signature, meta);
};

export const getZodMetadata = (
  signature: AxSignature
): AxZodMetadata | undefined => AxZodRegistry.get(signature);
