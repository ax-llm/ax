import { describe, expect, it } from 'vitest';

import { AxMockAIService } from '../ai/mock/api.js';
import { f } from './sig.js';
import { ax } from './template.js';

describe('Streaming Duplication Reproduction', () => {
  it('should not duplicate top-level string fields when extracting from partial JSON', async () => {
    const sig = f()
      .input('question', f.string())
      .output('action', f.string())
      .output('userMessage', f.string())
      .output('tags', f.string().array()) // Triggers structured outputs mode
      .useStructured()
      .build();

    const gen = ax(sig);

    const mockAI = new AxMockAIService({
      name: 'mock',
      features: { functions: true, streaming: true, structuredOutputs: true },
    });

    // Simulate streaming chunks that build up a JSON object incrementally
    // This simulates how an LLM might stream out a JSON object
    // Chunk 1: "{"chatResponse": {"action": "ask", "userMessage": "Hello"}}" (Full object in one go to keep it simple, or split it)

    // The issue is that ProcessStreamingResponse parses the *accumulated* content at each step.
    // If we send "{"chatResponse": {"action": "ask"}}" then "{"chatResponse": {"action": "ask", "userMessage": "He"}}" ...
    // The logic extracts "ask" first, then "ask" again + "He".

    // We need to simulate the raw chunks that the provider sends.
    const chunks = [
      '{"action": "ask"',
      ', "userMessage": "Hello", "tags": []}',
    ];

    // Expected behavior of the stream processor:
    // 1. Content: '{"chatResponse": {"action": "ask"' -> partial parse -> {chatResponse: {action: "ask"}}
    //    Yields delta: {chatResponse: {action: "ask"}}
    // 2. Content: '{"chatResponse": {"action": "ask", "userMessage": "Hello"}}' -> parse -> {chatResponse: {action: "ask", userMessage: "Hello"}}
    //    Current Bug: Yields delta: {chatResponse: {action: "ask", userMessage: "Hello"}}
    //    Merger sees "ask" (existing) and appends "ask" => "askask"

    mockAI.chat = async (_req, options) => {
      if (options?.stream) {
        const stream = new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              controller.enqueue({
                results: [{ index: 0, content: chunk }],
              });
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            controller.close();
          },
        });
        return stream as any;
      }
      return { results: [] };
    };

    const stream = gen.streamingForward(mockAI, { question: 'test' });

    // Simulate mergeDeltas behavior for strings
    const finalResult: any = { action: '', userMessage: '' };

    for await (const chunk of stream) {
      if (chunk.delta.action) {
        finalResult.action += chunk.delta.action;
      }
      if (chunk.delta.userMessage) {
        finalResult.userMessage += chunk.delta.userMessage;
      }
    }

    expect(finalResult.action).toBe('ask');
    expect(finalResult.userMessage).toBe('Hello');
  });
});
