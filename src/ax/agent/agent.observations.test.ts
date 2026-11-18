import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction } from '../ai/types.js';
import { f, fn } from '../dsp/sig.js';
import { agent } from './index.js';

function model(
  executor: (prompt: string, turn: number) => string | Promise<string>
) {
  const prompts: string[] = [];
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (request) => {
      const system = String(request.chatPrompt[0]?.content ?? '');
      const prompt = String(request.chatPrompt[1]?.content ?? '');
      let content: string;
      if (system.includes('You (`distiller`)')) {
        content =
          'Javascript Code: await final("Choose the available route", {})';
      } else if (system.includes('You (`executor`)')) {
        prompts.push(prompt);
        content = `Javascript Code: ${await executor(prompt, prompts.length)}`;
      } else {
        content = 'Answer: done';
      }
      return {
        results: [{ index: 0, content, finishReason: 'stop' }],
        modelUsage: {
          ai: 'mock',
          model: 'mock',
          tokens: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        },
      };
    },
  });
  return { ai, prompts };
}

function routingTools() {
  const calls: string[] = [];
  const lookup = fn('lookup')
    .namespace('routes')
    .description('Read the latest route advisory')
    .handler(() => {
      calls.push('lookup');
      return {
        note: 'The primary route is closed. Use the backup route.',
        receipt: 'read-once',
      };
    })
    .build();
  const commit = fn('commit')
    .namespace('routes')
    .description('Record a route choice. The route must be backup.')
    .arg('route', f.string())
    .arg('receipt', f.string().optional())
    .resultPolicy('data')
    .handler(({ route, receipt }) => {
      calls.push(`commit:${route}:${receipt ?? ''}`);
      return { recorded: route };
    })
    .build();
  return { calls, functions: [lookup, commit] };
}

async function run(
  ai: AxMockAIService,
  functions: AxFunction[],
  discovery = false
) {
  return agent('task:string -> answer:string', {
    functions,
    functionDiscovery: discovery,
    directResponse: 'off',
    contextFields: [],
    contextPolicy: { preset: 'full' },
    maxTurns: 4,
  }).forward(ai, { task: 'Choose the primary route if available.' });
}

describe('RLM observation boundaries', () => {
  it('loads the exact docs for a guessed callable without executing it', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model((prompt, turn) => {
      if (turn === 1)
        return `await routes.commit({ route: 'primary' }); await final('done', {});`;
      expect(prompt).toContain('The route must be backup');
      expect(calls).toEqual([]);
      return `await routes.commit({ route: 'backup' }); await final('done', {});`;
    });
    await run(ai, functions, true);
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['commit:backup:']);
  });

  it('reads discovered instructions before executing dependent code, including aliased discovery', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model((prompt, turn) => {
      if (turn === 1)
        return `
        const beforeDiscovery = 'read-once';
        const load = discover;
        await load(['routes.commit']);
        await routes.commit({ route: 'primary' });
        await final('done', {});
      `;
      expect(prompt).toContain('The route must be backup');
      expect(prompt).toContain('Discovery completed');
      return `const outcome = await routes.commit({ route: 'backup', receipt: beforeDiscovery }); await final('done', { outcome });`;
    });
    await run(ai, functions, true);
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['commit:backup:read-once']);
  });

  it('reacts to a result note before a dependent action and preserves the assigned result', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model((prompt, turn) => {
      if (turn === 1)
        return `
        const advisory = await routes.lookup({});
        await routes.commit({ route: 'primary' });
        await final('done', {});
      `;
      expect(prompt).toContain(
        'The primary route is closed. Use the backup route.'
      );
      return `const outcome = await routes.commit({ route: 'backup', receipt: advisory.receipt }); await final('done', { outcome });`;
    });
    await run(ai, functions);
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['lookup', 'commit:backup:read-once']);
  });

  it('cannot bypass inspection by catching the pause or finalizing in the same turn', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model((prompt, turn) => {
      if (turn === 1)
        return `
        const advisory = await routes.lookup({});
        try { await routes.commit({ route: 'primary' }); } catch {}
        await final('Ignore the advisory', {});
      `;
      expect(prompt).toContain('Use the backup route');
      return `await final('Report the closure', { advisory });`;
    });
    await run(ai, functions);
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['lookup']);
  });

  it('requires inspection even when the first block only reads and finalizes', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model((prompt, turn) => {
      if (turn === 1)
        return `const advisory = await routes.lookup({}); await final('done', { advisory });`;
      expect(prompt).toContain('Use the backup route');
      return `await final('Explain why primary is unavailable', { advisory });`;
    });
    await run(ai, functions);
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['lookup']);
  });

  it('keeps deterministic transformations and tool batches in one turn', async () => {
    const calls: number[] = [];
    const double = fn('double')
      .description('Multiply by two')
      .arg('value', f.number())
      .returns(f.number())
      .resultPolicy('data')
      .handler(({ value }) => {
        calls.push(value);
        return value * 2;
      })
      .build();
    const { ai, prompts } = model(
      () => `
      const values = await Promise.all([1, 2, 3].map(value => utils.double({ value })));
      const sum = values.reduce((total, value) => total + value, 0);
      const total = await utils.double({ value: sum });
      await final('Report the total', { total });
    `
    );
    await run(ai, [double]);
    expect(prompts).toHaveLength(1);
    expect(calls).toEqual([1, 2, 3, 12]);
  });

  it('does not let an inspection call without await be overtaken by an action or final', async () => {
    const { functions, calls } = routingTools();
    const lookup = functions[0]!;
    const original = lookup.func;
    lookup.func = async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return original();
    };
    // Use the exact emitted text; the next prompt must contain the completed
    // result even though the generated program forgot to await its promise.
    const check = model((prompt, turn) => {
      if (turn === 1)
        return `routes.lookup({}); await routes.commit({ route: 'primary' }); await final('done', {});`;
      expect(prompt).toContain(
        'The primary route is closed. Use the backup route.'
      );
      return `await routes.commit({ route: 'backup' }); await final('done', {});`;
    });
    await run(check.ai, functions);
    expect(check.prompts).toHaveLength(2);
    expect(calls).toEqual(['lookup', 'commit:backup:']);
  });

  it('pauses for memory recall before acting on the newly loaded preference', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model((prompt, turn) => {
      if (turn === 1)
        return `await recall(['route preference']); await routes.commit({ route: 'primary' }); await final('done', {});`;
      expect(prompt).toContain('Prefer backup for this customer');
      return `await routes.commit({ route: 'backup' }); await final('done', {});`;
    });
    await agent('task:string -> answer:string', {
      functions,
      directResponse: 'off',
      contextFields: [],
      onMemoriesSearch: async () => [
        { id: 'preference', content: 'Prefer backup for this customer.' },
      ],
    }).forward(ai, { task: 'Record the preferred route.' });
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['commit:backup:']);
  });

  it('cannot run a delayed action from old code while the next model turn is deciding', async () => {
    const { functions, calls } = routingTools();
    const { ai, prompts } = model(async (prompt, turn) => {
      if (turn === 1)
        return `
        routes.lookup({}).then(async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          await routes.commit({ route: 'primary' });
        });
        console.log('Reading the advisory');
      `;
      expect(prompt).toContain('Use the backup route');
      expect(calls).toEqual(['lookup']);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(calls).toEqual(['lookup']);
      return `await final('Report the closure', { note: 'Primary is closed' });`;
    });
    await run(ai, functions);
    expect(prompts).toHaveLength(2);
    expect(calls).toEqual(['lookup']);
  });
});
