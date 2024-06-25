import { existsSync } from 'node:fs';

import type { AxAIService } from '../ai/types.js';
import { AxDBMemory } from '../db/memory.js';
import { ColorLog } from '../util/log.js';

const colorLog = new ColorLog();

export interface AxRouterForwardOptions {
  cutoff?: number;
}

export class AxRoute {
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

export class AxRouter {
  private readonly ai: AxAIService;
  private db: AxDBMemory;
  private debug?: boolean;

  public constructor(ai: AxAIService) {
    this.db = new AxDBMemory();
    this.ai = ai;
  }

  public setRoutes = async (
    routes: readonly AxRoute[],
    options?: Readonly<{ filename?: string }>
  ): Promise<void> => {
    const fn = options?.filename;

    if (fn && existsSync(fn)) {
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

  public async forward(
    text: string,
    options?: Readonly<AxRouterForwardOptions>
  ): Promise<string> {
    const { embeddings } = await this.ai.embed({ texts: [text] });

    const matches = await this.db.query({
      table: 'routes',
      values: embeddings[0]
    });

    let m = matches.matches;
    if (typeof options?.cutoff === 'number') {
      const { cutoff } = options;
      m = m.filter((m) => m.score <= cutoff);
    }

    if (this.debug) {
      console.log(
        colorLog.whiteBright(`query: ${text}`) +
          '\n' +
          colorLog.greenBright(
            JSON.stringify(m.map((m) => `${m.id}, ${m.score}`))
          )
      );
    }

    const route = m.at(0);
    if (!route) {
      return '';
    }

    return route.id;
  }

  public setOptions(options: Readonly<{ debug?: boolean }>): void {
    if (typeof options.debug === 'boolean') {
      this.debug = options.debug;
    }
  }
}
