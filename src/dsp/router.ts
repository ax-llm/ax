import fs from 'node:fs';

import { TextModelInfo } from '../ai/index.js';
import { AIService } from '../text/index.js';

export class Route {
  private readonly name: string;
  private readonly context: readonly string[];

  constructor(name: string, context: readonly string[]) {
    this.name = name;
    this.context = context;
  }

  public getName(): string {
    return this.name;
  }

  public getContext(): readonly string[] {
    return this.context;
  }
}

export class Router {
  private readonly ai: AIService;
  private routeMap: Map<string, readonly (readonly number[])[]> = new Map();

  public constructor(ai: AIService) {
    this.ai = ai;
  }

  public setRoutes = async (
    routes: readonly Route[],
    options?: Readonly<{ filename?: string }>
  ): Promise<void> => {
    const fn = options?.filename;

    if (fn && fs.existsSync(fn)) {
      await this.loadRoutes(fn);
    }

    for (const ro of routes) {
      const ret = await this.ai.embed({ texts: ro.getContext() });
      this.routeMap.set(ro.getName(), ret.embeddings);
    }

    if (fn) {
      await this.saveRoutes(fn);
    }
  };

  private saveRoutes = async (filename: string) => {
    const routeMap = Array.from(this.routeMap.entries()).reduce(
      (acc, [key, value]) => {
        acc[key] = value;
        return acc;
      },
      {} as Record<string, readonly (readonly number[])[]>
    );
    const { name: model } = this.ai.getEmbedModelInfo() as TextModelInfo;
    const value = { model, routeMap };
    fs.writeFileSync(filename, JSON.stringify(value));
  };

  private loadRoutes = async (filename: string) => {
    const data = fs.readFileSync(filename, 'utf8');
    const value = JSON.parse(data);
    const config = this.ai.getEmbedModelInfo() as TextModelInfo;
    if (value.model !== config.name) {
      throw new Error('Model mismatch');
    }
    this.routeMap = new Map(
      Object.entries(value.routeMap).map(([key, value]) => [
        key,
        value as readonly (readonly number[])[]
      ])
    );
  };

  private distance = (a: readonly number[], b: readonly number[]): number => {
    if (a.length !== b.length) {
      throw new Error('Vectors must be of the same length.');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    let zeroVectorA = true;
    let zeroVectorB = true;

    // Using typed arrays for potentially better performance
    const vectorA = new Float64Array(a);
    const vectorB = new Float64Array(b);

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
      if (vectorA[i] !== 0) zeroVectorA = false;
      if (vectorB[i] !== 0) zeroVectorB = false;
    }

    if (zeroVectorA || zeroVectorB) {
      return 1; // Return maximum distance if one vector is zero
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - similarity; // Returning distance as 1 - cosine similarity.
  };

  public forward = async (text: string): Promise<string> => {
    const { embeddings } = await this.ai.embed({ texts: [text] });
    let bestRoute: string | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const routeKey of this.routeMap.keys()) {
      const routeEmbeddings = this.routeMap.get(routeKey);
      if (routeEmbeddings === undefined) {
        throw new Error('Route not found');
      }

      const distance = this.distance(embeddings[0], routeEmbeddings[0]);
      if (distance < bestDistance) {
        bestRoute = routeKey;
        bestDistance = distance;
      }
    }

    if (!bestRoute) {
      throw new Error('No route found');
    }

    return bestRoute;
  };
}
