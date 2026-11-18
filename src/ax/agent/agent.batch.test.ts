import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxFunction } from '../ai/types.js';
import { f, fn } from '../dsp/sig.js';
import { AxAIServiceAbortedError } from '../util/apicall.js';
import { DEFAULT_RLM_BATCH_CONCURRENCY } from './config.js';
import { agent } from './index.js';

async function execute(
  functions: AxFunction[],
  turn: (prompt: string, index: number) => string,
  discovery = false,
  options: {
    bubbleErrors?: readonly (new (...args: any[]) => Error)[];
    maxRuntimeChars?: number;
  } = {}
) {
  let turns = 0;
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async ({ chatPrompt }) => {
      const system = String(chatPrompt[0]?.content ?? '');
      const prompt = String(chatPrompt[1]?.content ?? '');
      const content = system.includes('You (`distiller`)')
        ? 'Javascript Code: await final("Complete the task using current evidence", {})'
        : system.includes('You (`executor`)')
          ? `Javascript Code: ${turn(prompt, ++turns)}`
          : 'Answer: done';
      return { results: [{ index: 0, content, finishReason: 'stop' }] };
    },
  });
  await agent('task:string -> answer:string', {
    functions,
    functionDiscovery: discovery,
    directResponse: 'off',
    maxTurns: 5,
    ...options,
  }).forward(ai, {
    task: 'Gather the evidence and complete the requested work.',
  });
  return turns;
}

describe('independent tool batches', () => {
  it('identifies same-function scalar results by their original descriptor index', async () => {
    const balance = fn('balance')
      .description('Read one account balance')
      .arg('account', f.string())
      .handler(async ({ account }) => {
        if (account === 'A')
          await new Promise((resolve) => setTimeout(resolve, 25));
        return account === 'A' ? 10 : 20;
      })
      .build();
    const turns = await execute([balance], (prompt, index) => {
      if (index === 1)
        return `const balances = await batch([
        { name: 'utils.balance', args: { account: 'A' } },
        { name: 'utils.balance', args: { account: 'B' } }
      ]);`;
      expect(prompt).toContain('batch[0] utils.balance: 10');
      expect(prompt).toContain('batch[1] utils.balance: 20');
      return `await final('Report the balances in account order', { balances });`;
    });
    expect(turns).toBe(2);
  });

  it('preserves the first trusted guidance and stops queued work while settling active calls', async () => {
    const calls: number[] = [];
    const review = fn('review')
      .description('Review one item and redirect when necessary')
      .arg('item', f.number())
      .handler(async ({ item }, extra) => {
        calls.push(item);
        if (item === 0)
          extra?.protocol?.guideAgent('Use the contingency procedure.');
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (item === 1)
          extra?.protocol?.guideAgent('Discard the contingency procedure.');
        return `completed-item-${item}`;
      })
      .build();
    const turns = await execute([review], (prompt, index) => {
      if (index === 1)
        return `await batch(Array.from({ length: ${DEFAULT_RLM_BATCH_CONCURRENCY + 3} }, (_, item) => ({ name: 'utils.review', args: { item } })));`;
      expect(prompt).toContain('Use the contingency procedure.');
      expect(prompt).not.toContain('Discard the contingency procedure.');
      expect(prompt).toContain('completed-item-2');
      expect(calls).toHaveLength(DEFAULT_RLM_BATCH_CONCURRENCY);
      return `await final('Explain the required contingency procedure', {});`;
    });
    expect(turns).toBe(2);
  });

  it('bubbles fatal errors without starting queued members', async () => {
    class FatalBatchError extends Error {}
    const calls: number[] = [];
    const update = fn('update')
      .description('Apply one independent update')
      .arg('item', f.number())
      .handler(async ({ item }) => {
        calls.push(item);
        if (item === 0) throw new FatalBatchError('Stop this batch');
        await new Promise((resolve) => setTimeout(resolve, 20));
        return item;
      })
      .build();
    await expect(
      execute(
        [update],
        () =>
          `await batch(Array.from({ length: ${DEFAULT_RLM_BATCH_CONCURRENCY + 3} }, (_, item) => ({ name: 'utils.update', args: { item } })));`,
        false,
        { bubbleErrors: [FatalBatchError] }
      )
    ).rejects.toBeInstanceOf(FatalBatchError);
    expect(calls).toHaveLength(DEFAULT_RLM_BATCH_CONCURRENCY);
  });

  it('propagates framework cancellation instead of converting it to tool evidence', async () => {
    const cancelled = new AxAIServiceAbortedError('test', 'cancelled upstream');
    const read = fn('read')
      .description('Read evidence from an upstream service')
      .handler(() => {
        throw cancelled;
      })
      .build();
    await expect(
      execute([read], () => `await batch([{ name: 'utils.read' }]);`)
    ).rejects.toBe(cancelled);
  });

  it('gathers concurrent inspection results before choosing a dependent action', async () => {
    const calls: string[] = [];
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const search = fn('search')
      .description('Search the selected evidence source')
      .arg('source', f.string())
      .handler(async ({ source }) => {
        calls.push(source);
        if (calls.length === 2) release();
        await bothStarted;
        return source === 'archive'
          ? 'Archive lists revision 7.'
          : 'Current bulletin: revision 7 was withdrawn; use revision 9.';
      })
      .build();
    const publish = fn('publish')
      .description('Publish the selected revision')
      .arg('revision', f.number())
      .resultPolicy('data')
      .handler(({ revision }) => {
        calls.push(`publish:${revision}`);
      })
      .build();
    const turns = await execute([search, publish], (prompt, index) => {
      if (index === 1)
        return `
        const sources = await batch([
          { name: 'utils.search', args: { source: 'archive' } },
          { name: 'utils.search', args: { source: 'current' } }
        ]);
        await utils.publish({ revision: 7 });
        await final('done', {});
      `;
      expect(prompt).toContain('revision 7 was withdrawn');
      expect(calls).toEqual(['archive', 'current']);
      return `await utils.publish({ revision: 9 }); await final('done', { sources });`;
    });
    expect(turns).toBe(2);
    expect(calls).toEqual(['archive', 'current', 'publish:9']);
  });

  it('uses spare space from a short batch result to show the next decision in full', async () => {
    const destinations: string[] = [];
    const read = fn('read')
      .description('Read one source')
      .arg('short', f.boolean())
      .handler(({ short }) =>
        short ? 'ok' : `${'x'.repeat(340)} destination=west`
      )
      .build();
    const send = fn('send')
      .description('Route the item')
      .arg('destination', f.string())
      .resultPolicy('data')
      .handler(({ destination }) => {
        destinations.push(destination);
      })
      .build();
    const turns = await execute(
      [read, send],
      (prompt, index) => {
        if (index === 1)
          return `await batch([
        {name:'utils.read', args:{short:true}},
        {name:'utils.read', args:{short:false}}
      ]); await utils.send({destination:'east'});`;
        expect(destinations).toEqual([]);
        const destination = /destination=(west)/.exec(prompt)?.[1];
        expect(destination).toBe('west');
        return `await utils.send({destination:${JSON.stringify(destination)}}); await final('Report', {});`;
      },
      false,
      { maxRuntimeChars: 720 }
    );
    expect(turns).toBe(2);
    expect(destinations).toEqual(['west']);
  });

  it('preserves successes when another batch member fails and retries only failed work', async () => {
    const calls: string[] = [];
    const fetch = fn('fetch')
      .description('Read one item')
      .arg('key', f.string())
      .handler(({ key }) => {
        calls.push(key);
        if (key === 'old')
          throw new Error('This item moved to replacement-key.');
        return { key, content: `content-${key}` };
      })
      .build();
    const turns = await execute([fetch], (prompt, index) => {
      if (index === 1)
        return `const gathered = await batch([
        { name: 'utils.fetch', args: { key: 'stable' } },
        { name: 'utils.fetch', args: { key: 'old' } }
      ]);`;
      if (index === 2) {
        expect(prompt).toContain('replacement-key');
        expect(prompt).toContain('content-stable');
        return `const replacement = await utils.fetch({ key: 'replacement-key' });`;
      }
      return `if (gathered[0].value.key !== 'stable' || gathered[1].status !== 'rejected') throw new Error('lost batch outcome'); await final('done', { stable: gathered[0].value, replacement });`;
    });
    expect(turns).toBe(3);
    expect(calls).toEqual(['stable', 'old', 'replacement-key']);
  });

  it('discovers every missing contract before executing any batch member', async () => {
    const calls: string[] = [];
    const first = fn('first')
      .description('Requires audit code alpha.')
      .arg('audit', f.string())
      .resultPolicy('data')
      .handler(({ audit }) => {
        calls.push(audit);
        return audit;
      })
      .build();
    const second = fn('second')
      .description('Requires audit code beta.')
      .arg('audit', f.string())
      .resultPolicy('data')
      .handler(({ audit }) => {
        calls.push(audit);
        return audit;
      })
      .build();
    const turns = await execute(
      [first, second],
      (prompt, index) => {
        if (index === 1)
          return `const outputs = await batch([{ name: 'utils.first', args: { audit: 'guess' } }, { name: 'utils.second', args: { audit: 'guess' } }]); await final('done', {});`;
        expect(prompt).toContain('audit code alpha');
        expect(prompt).toContain('audit code beta');
        expect(calls).toEqual([]);
        return `const outputs = await batch([{ name: 'utils.first', args: { audit: 'alpha' } }, { name: 'utils.second', args: { audit: 'beta' } }]); await final('done', { outputs });`;
      },
      true
    );
    expect(turns).toBe(2);
    expect(calls).toEqual(['alpha', 'beta']);
  });

  it('keeps data batches and deterministic follow-up computations in one turn', async () => {
    const calls: number[] = [];
    const double = fn('double')
      .description('Double a number')
      .arg('n', f.number())
      .resultPolicy('data')
      .handler(({ n }) => {
        calls.push(n);
        return n * 2;
      })
      .build();
    const turns = await execute(
      [double],
      () => `
      const outputs = await batch([1, 2, 3].map(n => ({ name: 'utils.double', args: { n } })));
      const total = outputs.reduce((sum, result) => sum + result.value, 0);
      await utils.double({ n: total });
      await final('done', { total });
    `
    );
    expect(turns).toBe(1);
    expect(calls).toEqual([1, 2, 3, 12]);
  });

  it('validates the entire batch before any side effects', async () => {
    const calls: string[] = [];
    const update = fn('update')
      .description('Apply an update')
      .resultPolicy('data')
      .handler(() => {
        calls.push('updated');
      })
      .build();
    const turns = await execute([update], (prompt, index) => {
      if (index === 1)
        return `await batch([{ name: 'utils.update' }, { name: 'utils.missing' }]);`;
      expect(prompt).toContain('Unknown batch function: utils.missing');
      expect(calls).toEqual([]);
      return `await utils.update(); await final('done', {});`;
    });
    expect(turns).toBe(2);
    expect(calls).toEqual(['updated']);
  });
});
