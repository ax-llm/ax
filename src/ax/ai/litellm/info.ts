import type { AxModelInfo } from '../types.js';

/**
 * LiteLLM model info is empty by default since models are dynamic
 * and depend on the proxy configuration. Users can pass custom
 * modelInfo via the constructor to enable cost tracking.
 */
export const axModelInfoLiteLLM: AxModelInfo[] = [];
