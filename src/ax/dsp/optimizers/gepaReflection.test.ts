import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../../ai/mock/api.js';
import {
  proposeGEPAComponentValue,
  renderReflectiveValue,
  summarizeGEPATraces,
} from './gepaReflection.js';

describe('GEPA reflection helpers', () => {
  it('renders nested values as JSON instead of [object Object]', () => {
    const rendered = renderReflectiveValue({
      recursiveTrace: { root: { children: [{ taskDigest: 'branch-a' }] } },
      extra: { nested: ['value'] },
    });

    expect(rendered).toContain('"taskDigest": "branch-a"');
    expect(rendered).toContain('"nested": [');
    expect(rendered).not.toContain('[object Object]');
  });

  it('proposes a value for a component whose current value is empty', async () => {
    let prompt = '';
    const ai = new AxMockAIService<string>({
      chatResponse: async (req) => {
        prompt = JSON.stringify(req.chatPrompt);
        return {
          results: [
            {
              index: 0,
              content: 'New Value: Answer in one sentence.',
              finishReason: 'stop',
            },
          ],
        };
      },
    });

    const proposed = await proposeGEPAComponentValue({
      ai,
      target: { id: 'root::instruction', kind: 'instruction', current: '' },
      currentValue: '',
      tuples: [],
    });

    expect(proposed).toBe('Answer in one sentence.');
    expect(prompt).not.toContain('Current Value');
  });

  it('rethrows the teacher error when the last attempt fails', async () => {
    const ai = new AxMockAIService<string>({
      shouldError: true,
      errorMessage: 'teacher unavailable',
    });

    await expect(
      proposeGEPAComponentValue({
        ai,
        target: { id: 'root::instruction', kind: 'instruction', current: 'x' },
        currentValue: 'x',
        tuples: [],
        maxAttempts: 2,
      })
    ).rejects.toThrow('teacher unavailable');
  });

  it('summarizes trace rows with bounded previews', () => {
    const summary = summarizeGEPATraces(
      [
        {
          score: 0,
          calls: [
            {
              componentId: 'lookup_user',
              fn: 'lookup_user',
              ok: false,
              ms: 12,
              args: { query: 'x'.repeat(300) },
              result: { error: 'not found' },
            },
          ],
          error: 'failed',
        },
      ],
      { maxValueChars: 80 }
    );

    expect(summary?.[0]?.calls[0]).toMatchObject({
      componentId: 'lookup_user',
      fn: 'lookup_user',
      ok: false,
      ms: 12,
    });
    expect(summary?.[0]?.calls[0]?.args.length).toBeLessThanOrEqual(80);
  });

  it('passes validation errors into retry prompts and accepts a corrected value', async () => {
    const seenPrompts: string[] = [];
    let calls = 0;
    const ai = new AxMockAIService({
      chatResponse: async (req) => {
        seenPrompts.push(JSON.stringify(req.chatPrompt));
        calls++;
        return {
          results: [
            {
              index: 0,
              content:
                calls === 1 ? 'New Value: bad value' : 'New Value: good_value',
              finishReason: 'stop',
            },
          ],
        };
      },
    });

    const proposed = await proposeGEPAComponentValue({
      ai,
      target: {
        id: 'root::fn:lookup:name',
        kind: 'fn-name',
        current: 'lookup',
        format: 'snake_case',
        validate: (value) =>
          value === 'good_value' ? true : 'must be snake_case',
      },
      currentValue: 'lookup',
      tuples: [],
      maxAttempts: 2,
    });

    expect(proposed).toBe('good_value');
    expect(seenPrompts[1]).toContain('must be snake_case');
  });
});
