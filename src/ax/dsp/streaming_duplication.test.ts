import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import { AxAIServiceStreamTerminatedError } from '../util/apicall.js';
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

    const mockAI = new AxMockAIService<string>({
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
    const fullJson =
      '{"action": "askUser", "userMessage": "Hello", "tags": []}';
    // So we should define chunks as parts of the string.
    const rawChunks = fullJson.match(/.{1,3}/g) || [];

    // Expected behavior of the stream processor:
    // 1. Content: '{"chatResponse": {"action": "ask"' -> partial parse -> {chatResponse: {action: "ask"}}
    //    Yields delta: {chatResponse: {action: "ask"}}
    // 2. Content: '{"chatResponse": {"action": "ask", "userMessage": "Hello"}}' -> parse -> {chatResponse: {action: "ask", userMessage: "Hello"}}
    //    Current Bug: Yields delta: {chatResponse: {action: "ask", userMessage: "Hello"}}
    //    Merger sees "ask" (existing) and appends "ask" => "askask"

    let attempt = 0;

    mockAI.chat = async (_req, options) => {
      attempt++;
      if (options?.stream) {
        const stream = new ReadableStream({
          async start(controller) {
            let i = 0;
            for (const chunk of rawChunks) {
              controller.enqueue({
                results: [{ index: 0, content: chunk }],
              });
              await new Promise((resolve) => setTimeout(resolve, 10));

              // Simulate failure mid-stream on first attempt
              if (attempt === 1 && i === 5) {
                // controller.error(new Error('Stream failed')); // valid way to error stream?
                // Or just throw?
                // For vitest environment, we can throw inside loop or enqueue error
                controller.error(
                  new AxAIServiceStreamTerminatedError('Simulated Stream Error')
                );
                return;
              }
              i++;
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

    // With the bug, we expect duplication because the first attempt yielded some chunks
    // and the second attempt yielded all chunks.
    // 'askUser' is 7 chars.
    // chunks are length 3.
    // Chunk 0: "{"
    // Chunk 1: "action" "ask"
    // Chunk 2: ...
    // If we fail at i=5 (6th chunk).

    // We expect valid result finally, but with duplication if not handled.
    // So 'action' might be 'askUser' + partial 'ask...'

    // For this reproduction, we verify that it IS duplicated.
    expect(finalResult.action).toBe('askUser');
    expect(finalResult.userMessage).toBe('Hello');
  });
});
