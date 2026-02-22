import { describe, expect, it } from 'vitest';
import { AxDefaultAdapter } from './adapter.js';
import { AxSignature } from './sig.js';

describe('AxDefaultAdapter - Multi-turn Demos', () => {
  it('should render demos with function results correctly', () => {
    const signature = new AxSignature('query:string -> answer:string');
    const adapter = new AxDefaultAdapter(signature, { contextCache: {} });

    const demos = [
      {
        query: 'What is the weather in London?',
        functionName: 'getWeather',
        functionArguments: JSON.stringify({ location: 'London' }),
        functionResultMessage: 'The weather in London is 15C and sunny.',
        answer: 'The weather in London is 15C and sunny.',
      },
    ];

    const messages = adapter.render({ query: 'Current query' }, { demos });

    // Expected: System, User (query), Assistant (call), Function (result), Assistant (answer), User (final)
    expect(messages).toHaveLength(6);

    expect(messages[0].role).toBe('system');

    expect(messages[1].role).toBe('user');
    expect((messages[1] as any).content).toContain(
      'What is the weather in London?'
    );

    expect(messages[2].role).toBe('assistant');
    expect((messages[2] as any).functionCalls).toBeDefined();
    expect((messages[2] as any).functionCalls[0].function.name).toBe(
      'getWeather'
    );

    expect(messages[3].role).toBe('function');
    expect((messages[3] as any).result).toBe(
      'The weather in London is 15C and sunny.'
    );

    expect(messages[4].role).toBe('assistant');
    expect((messages[4] as any).content).toContain(
      'The weather in London is 15C and sunny.'
    );
    expect((messages[4] as any).cache).toBe(true);

    expect(messages[5].role).toBe('user');
    expect((messages[5] as any).content).toContain('Current query');
  });
});
