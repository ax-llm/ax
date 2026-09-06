import { expect, it } from 'vitest';
import { ai } from '../wrap.js';

class FixtureSocket {
  static current: FixtureSocket;
  listeners = new Map<string, Set<(event: any) => void>>();
  constructor() {
    FixtureSocket.current = this;
    queueMicrotask(() => this.emit('open', {}));
  }
  addEventListener(type: string, listener: (event: any) => void) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }
  send(_data: string) {}
  close() {}
  emit(type: string, event: any) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  event(event: unknown) {
    this.emit('message', { data: JSON.stringify(event) });
  }
}

it('normalizes distinct steering acknowledgements without duplicating accepted updates', async () => {
  const model = 'gpt-6-astra';
  const llm = ai({
    name: 'openai',
    apiKey: 'test',
    config: { model },
    options: { webSocket: FixtureSocket },
  });
  const session = await llm.openChatSession({
    chatPrompt: [{ role: 'user', content: 'Hello' }],
  });
  const socket = FixtureSocket.current;
  const response = {
    id: 'r1',
    model,
    output: [],
    status: 'completed',
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  socket.event({ type: 'response.created', response });
  for (const [id, sequence] of [
    ['s1', 1],
    ['s1', 1],
    ['s2', 2],
  ] as const)
    socket.event({
      type: 'response.steer.accepted',
      sequence_number: sequence,
      steer: { id, previous_response_id: 'r1' },
    });
  socket.event({ type: 'response.completed', response });
  const steering = [];
  for await (const event of session.events()) {
    if (event.type === 'steering') steering.push(event);
    if (event.type === 'response.completed') break;
  }
  session.close();
  expect(steering).toHaveLength(2);
  expect(steering).toEqual([
    { type: 'steering', status: 'accepted', responseId: 'r1', steerId: 's1' },
    { type: 'steering', status: 'accepted', responseId: 'r1', steerId: 's2' },
  ]);
});
