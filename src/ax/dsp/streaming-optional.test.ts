// cspell:ignore ional

import { ReadableStream } from 'node:stream/web';

import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';

import { AxGen } from './generate.js';

function createStreamingResponse(
  chunks: AxChatResponse['results']
): ReadableStream<AxChatResponse> {
  return new ReadableStream<AxChatResponse>({
    start(controller) {
      let count = 0;

      const processChunks = async () => {
        if (count >= chunks.length || controller.desiredSize === null) {
          if (controller.desiredSize !== null) {
            controller.close();
          }
          return;
        }

        const chunk = chunks[count];
        if (!chunk) {
          return;
        }

        const response: AxChatResponse = {
          results: [chunk],
          modelUsage: {
            ai: 'test-ai',
            model: 'test-model',
            tokens: {
              promptTokens: 10 + count,
              completionTokens: 5 + count,
              totalTokens: 15 + 2 * count,
            },
          },
        };

        if (!controller.desiredSize || controller.desiredSize <= 0) {
          return;
        }

        controller.enqueue(response);
        count++;

        if (count < chunks.length) {
          setTimeout(processChunks, 10);
        } else {
          if (controller.desiredSize !== null) {
            controller.close();
          }
        }
      };

      setTimeout(processChunks, 10);
    },
    cancel() {},
  });
}

describe('AxGen Streaming Optional Fields', () => {
  describe('Required field first, optional field second', () => {
    const signature =
      'userInput:string -> requiredField:string, optionalField?:string';

    it('should handle streaming when optional field is missing (non-strict mode)', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: This is ' },
        { index: 0, content: 'the required content' },
        { index: 0, content: ' only', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalField?: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true, strictMode: false }
      );

      expect(result.requiredField).toBe('This is the required content only');
      expect(result.optionalField).toBeUndefined();
    });

    it('should handle streaming when both fields are present', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: This is required\n' },
        { index: 0, content: 'Optional Field: This is ' },
        { index: 0, content: 'optional content', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalField?: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.requiredField).toBe('This is required');
      expect(result.optionalField).toBe('This is optional content');
    });
  });

  describe('Optional field first, required field second', () => {
    const signature =
      'userInput:string -> optionalField?:string, requiredField:string';

    it('should handle streaming when optional field is missing but required field is present', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: This is ' },
        { index: 0, content: 'the required content', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { optionalField?: string; requiredField: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.optionalField).toBeUndefined();
      expect(result.requiredField).toBe('This is the required content');
    });

    it('should handle streaming when both fields are present', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Optional Field: This is optional\n' },
        { index: 0, content: 'Required Field: This is ' },
        { index: 0, content: 'required', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { optionalField?: string; requiredField: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.optionalField).toBe('This is optional');
      expect(result.requiredField).toBe('This is required');
    });
  });

  describe('Multiple optional fields', () => {
    const signature =
      'userInput:string -> requiredField:string, optionalA?:string, optionalB?:string';

    it('should handle streaming with only required field present', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: Only ' },
        { index: 0, content: 'this field is present', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalA?: string; optionalB?: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.requiredField).toBe('Only this field is present');
      expect(result.optionalA).toBeUndefined();
      expect(result.optionalB).toBeUndefined();
    });

    it('should handle streaming with partial optional fields', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: Required content\n' },
        { index: 0, content: 'Optional A: First ' },
        { index: 0, content: 'optional field', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalA?: string; optionalB?: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.requiredField).toBe('Required content');
      expect(result.optionalA).toBe('First optional field');
      expect(result.optionalB).toBeUndefined();
    });

    it('should handle streaming with all fields present', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: Required content\n' },
        { index: 0, content: 'Optional A: First optional\n' },
        { index: 0, content: 'Optional B: Second ' },
        { index: 0, content: 'optional', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalA?: string; optionalB?: string }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.requiredField).toBe('Required content');
      expect(result.optionalA).toBe('First optional');
      expect(result.optionalB).toBe('Second optional');
    });
  });

  describe('Streaming validation edge cases', () => {
    const signature =
      'userInput:string -> optionalFirst?:string, requiredSecond:string, optionalThird?:string';

    it('should handle missing optional fields at beginning and end', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Second: Only ' },
        { index: 0, content: 'required field present', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        {
          optionalFirst?: string;
          requiredSecond: string;
          optionalThird?: string;
        }
      >(signature);

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.optionalFirst).toBeUndefined();
      expect(result.requiredSecond).toBe('Only required field present');
      expect(result.optionalThird).toBeUndefined();
    });

    it('should fail in strict mode when required field is missing', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Optional First: Only ' },
        { index: 0, content: 'optional field', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        {
          optionalFirst?: string;
          requiredSecond: string;
          optionalThird?: string;
        }
      >(signature);

      await expect(
        gen.forward(
          ai,
          { userInput: 'test' },
          { stream: true, strictMode: true }
        )
      ).rejects.toThrow(/Generate failed/);
    });
  });

  describe('Single optional field scenarios', () => {
    const signature = 'userInput:string -> optionalField?:string';

    it('should handle streaming when single optional field is missing (non-strict mode)', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Just some plain text without field prefix' },
        { index: 0, content: ' more content', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        signature
      );

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true, strictMode: false }
      );

      expect(result.optionalField).toBe(
        'Just some plain text without field prefix more content'
      );
    });

    it('should handle streaming when single optional field is present with prefix', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Optional Field: This is ' },
        { index: 0, content: 'the optional content', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        signature
      );

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.optionalField).toBe('This is the optional content');
    });

    it('should handle empty response with single optional field', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: '', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        signature
      );

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true, strictMode: false }
      );

      expect(result.optionalField).toBeUndefined();
    });

    it('should handle whitespace-only response with single optional field', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: '   \n  \t  ', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        signature
      );

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true, strictMode: false }
      );

      expect(result.optionalField).toBeUndefined();
    });

    it('should handle incomplete prefix in streaming with single optional field', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Opt' },
        {
          index: 0,
          content: 'ional Field: Complete content here',
          finishReason: 'stop',
        },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        signature
      );

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true }
      );

      expect(result.optionalField).toBe('Complete content here');
    });

    it('should ignore unprefixed content in strict mode when single optional field has no prefix', async () => {
      const chunks: AxChatResponse['results'] = [
        {
          index: 0,
          content: 'Just some content without prefix',
          finishReason: 'stop',
        },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        signature
      );

      const result = await gen.forward(
        ai,
        { userInput: 'test' },
        { stream: true, strictMode: true }
      );

      // In strict mode with only optional fields, unprefixed content should be ignored
      expect(result.optionalField).toBeUndefined();
    });
  });

  describe('streamingForward tests', () => {
    const signature =
      'userInput:string -> requiredField:string, optionalField?:string';

    it('should stream deltas correctly when optional field is missing', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: This is ' },
        { index: 0, content: 'streaming content', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalField?: string }
      >(signature);

      const stream = await gen.streamingForward(ai, { userInput: 'test' });

      const deltas: Array<{
        index: number;
        delta: Partial<{ requiredField: string; optionalField?: string }>;
      }> = [];
      for await (const delta of stream) {
        deltas.push(delta);
      }

      // Should only have deltas for the required field
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.every((d) => d.delta.requiredField !== undefined)).toBe(
        true
      );
      expect(deltas.every((d) => d.delta.optionalField === undefined)).toBe(
        true
      );
    });

    it('should stream deltas correctly when both fields are present', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Required Field: Required content\n' },
        { index: 0, content: 'Optional Field: Optional ' },
        { index: 0, content: 'content', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const gen = new AxGen<
        { userInput: string },
        { requiredField: string; optionalField?: string }
      >(signature);

      const stream = await gen.streamingForward(ai, { userInput: 'test' });

      const deltas: Array<{
        index: number;
        delta: Partial<{ requiredField: string; optionalField?: string }>;
      }> = [];
      for await (const delta of stream) {
        deltas.push(delta);
      }

      // Should have deltas for both fields
      expect(deltas.length).toBeGreaterThan(0);
      const hasRequiredField = deltas.some(
        (d) => d.delta.requiredField !== undefined
      );
      const hasOptionalField = deltas.some(
        (d) => d.delta.optionalField !== undefined
      );
      expect(hasRequiredField).toBe(true);
      expect(hasOptionalField).toBe(true);
    });

    it('should stream deltas correctly for single optional field', async () => {
      const chunks: AxChatResponse['results'] = [
        { index: 0, content: 'Just streaming content ' },
        { index: 0, content: 'without prefix', finishReason: 'stop' },
      ];
      const streamingResponse = createStreamingResponse(chunks);

      const ai = new AxMockAIService({
        features: { functions: false, streaming: true },
        chatResponse: streamingResponse,
      });

      const singleOptionalSignature =
        'userInput:string -> optionalField?:string';
      const gen = new AxGen<{ userInput: string }, { optionalField?: string }>(
        singleOptionalSignature
      );

      const stream = await gen.streamingForward(
        ai,
        { userInput: 'test' },
        { strictMode: false }
      );

      const deltas: Array<{
        index: number;
        delta: Partial<{ optionalField?: string }>;
      }> = [];
      for await (const delta of stream) {
        deltas.push(delta);
      }

      // Should have streaming deltas for the optional field
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.some((d) => d.delta.optionalField !== undefined)).toBe(
        true
      );
    });
  });
});
