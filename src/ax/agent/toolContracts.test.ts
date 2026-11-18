import { describe, expect, it } from 'vitest';
import type { AxFunctionJSONSchema } from '../ai/types.js';
import { axBuildExecutorDefinition } from './rlm.js';
import { renderDiscoveryFunctionDefinitionsMarkdown } from './runtimeDiscovery.js';

describe('tool contracts reach the model', () => {
  const parameters: AxFunctionJSONSchema = {
    type: 'object',
    properties: {
      cursor: {
        type: 'string',
        description: 'Use the opaque cursor returned by the previous page.',
      },
    },
  };
  const returns: AxFunctionJSONSchema = {
    type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
    description:
      'Returns an object with rows and nextCursor; nextCursor is absent on the last page.',
  };
  const fn = {
    name: 'page',
    namespace: 'ledger',
    description: 'Read a page.',
    parameters,
    returns,
  };
  it.each(['JavaScript', 'Python'])(
    'preserves argument and return prose in inline %s docs',
    (language) => {
      const prompt = axBuildExecutorDefinition(undefined, [], [], {
        runtimeLanguageName: language,
        isJavaScriptRuntime: language === 'JavaScript',
        agentFunctions: [fn],
      });
      expect(prompt).toContain(
        'Use the opaque cursor returned by the previous page'
      );
      expect(prompt).toContain('nextCursor is absent on the last page');
    }
  );
  it('preserves the same return contract after discovery', () => {
    const prompt = renderDiscoveryFunctionDefinitionsMarkdown(
      ['ledger.page'],
      new Map([['ledger.page', { ...fn, module: 'ledger' }]])
    );
    expect(prompt).toContain(
      'Use the opaque cursor returned by the previous page'
    );
    expect(prompt).toContain('nextCursor is absent on the last page');
  });
});
