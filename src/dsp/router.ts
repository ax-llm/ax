import fs from 'fs';

import { MemoryDB } from '../db/memory.js';
import type { AIService } from '../text/index.js';

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
  private db: MemoryDB;

  public constructor(ai: AIService) {
    this.db = new MemoryDB();
    this.ai = ai;
  }

  public setRoutes = async (
    routes: readonly Route[],
    options?: Readonly<{ filename?: string }>
  ): Promise<void> => {
    const fn = options?.filename;

    if (fn && fs.existsSync(fn)) {
      await this.db.load(fn);
    }

    for (const ro of routes) {
      const ret = await this.ai.embed({ texts: ro.getContext() });
      await this.db.upsert({
        id: ro.getName(),
        table: 'routes',
        values: ret.embeddings[0]
      });
    }

    if (fn) {
      await this.db.save();
    }
  };

  public forward = async (text: string): Promise<string> => {
    const { embeddings } = await this.ai.embed({ texts: [text] });

    const matches = await this.db.query({
      table: 'routes',
      values: embeddings[0]
    });

    const route = matches.matches.at(0);
    if (!route) {
      return '';
    }

    return route.id;
  };
}
