import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import type { AxChatResponse } from '../ai/types.js';
import { runControl } from '../dsp/runControl.js';
import { agent } from './index.js';

type Stage = 'distiller' | 'executor' | 'responder';

// A scripted model that answers each stage by its system prompt and lets a
// test act while a given stage's request is in flight.
function scriptedAI(onRequest?: (stage: Stage) => void) {
  const requests: { stage: Stage; text: string }[] = [];
  const ai = new AxMockAIService<string>({
    features: { functions: false, streaming: true },
    chatResponse: async (req) => {
      const system = String(req.chatPrompt[0]?.content ?? '');
      const stage: Stage = system.includes('You (`distiller`)')
        ? 'distiller'
        : system.includes('You (`executor`)')
          ? 'executor'
          : 'responder';
      requests.push({ stage, text: JSON.stringify(req.chatPrompt) });
      onRequest?.(stage);
      const content =
        stage === 'distiller'
          ? 'Javascript Code: await final("Answer the question", {})'
          : stage === 'executor'
            ? 'Javascript Code: await final("Answer the question", { policy: "30 days" })'
            : undefined;
      if (content !== undefined) {
        return {
          results: [{ index: 0, content, finishReason: 'stop' }],
        } as AxChatResponse;
      }
      const chunks = ['Answer: Refunds ', 'take 30 ', 'days.'];
      return new ReadableStream<AxChatResponse>({
        pull(controller) {
          const chunk = chunks.shift();
          if (chunk === undefined) {
            controller.close();
            return;
          }
          controller.enqueue({
            results: [
              {
                index: 0,
                content: chunk,
                ...(chunks.length === 0 ? { finishReason: 'stop' } : {}),
              },
            ],
          } as AxChatResponse);
        },
      });
    },
  });
  return { ai, requests };
}

function recordEvents(control: ReturnType<typeof runControl>) {
  const events: string[] = [];
  control.onEvent((event) => {
    events.push(
      `${event.type}@${event.path}${event.updateId === undefined ? '' : `#${event.updateId}`}`
    );
  });
  return events;
}

describe('AxAgent.streamingForward under a run control', () => {
  it('reports the run and its stages at the paths forward uses', async () => {
    const control = runControl();
    const events = recordEvents(control);
    const { ai } = scriptedAI();
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      maxTurns: 4,
    });
    const deltas: unknown[] = [];
    for await (const delta of ag.streamingForward(
      ai,
      { question: 'How long do refunds take?' },
      { control }
    )) {
      deltas.push(delta);
    }
    expect(deltas.length).toBeGreaterThan(0);
    expect(events).toEqual([
      'started@root',
      'started@root/distiller',
      'completed@root/distiller',
      'started@root/executor',
      'completed@root/executor',
      'started@root/responder',
      'completed@root/responder',
      'completed@root',
    ]);
  });

  it('applies a steer targeted at the executor to the executor', async () => {
    const control = runControl();
    const events = recordEvents(control);
    let queued = false;
    const { ai, requests } = scriptedAI((stage) => {
      if (stage === 'distiller' && !queued) {
        queued = true;
        control.steer('STEER-EXECUTOR-ONLY', { target: 'root/executor' });
      }
    });
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      maxTurns: 4,
    });
    for await (const _ of ag.streamingForward(
      ai,
      { question: 'How long do refunds take?' },
      { control }
    )) {
    }
    expect(
      requests.map(
        ({ stage, text }) =>
          `${stage}${text.includes('STEER-EXECUTOR-ONLY') ? ' [steer]' : ''}`
      )
    ).toEqual(['distiller', 'executor [steer]', 'responder']);
    expect(events).toContain('applied@root/executor#1');
  });

  it('reports an early stop as aborted for the responder and the run', async () => {
    const control = runControl();
    const events = recordEvents(control);
    const { ai } = scriptedAI();
    const ag = agent('question:string -> answer:string', {
      ai,
      directResponse: 'off',
      maxTurns: 4,
    });
    for await (const _ of ag.streamingForward(
      ai,
      { question: 'How long do refunds take?' },
      { control }
    )) {
      break;
    }
    expect(events).toEqual([
      'started@root',
      'started@root/distiller',
      'completed@root/distiller',
      'started@root/executor',
      'completed@root/executor',
      'started@root/responder',
      'aborted@root/responder',
      'aborted@root',
    ]);
  });
});
