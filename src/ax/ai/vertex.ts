const VERTEX_MULTI_REGIONS = new Set(['us', 'eu']);

export const resolveVertexAIHost = (region: string): string => {
  if (region === 'global') {
    return 'aiplatform.googleapis.com';
  }

  if (VERTEX_MULTI_REGIONS.has(region)) {
    return `aiplatform.${region}.rep.googleapis.com`;
  }

  return `${region}-aiplatform.googleapis.com`;
};
