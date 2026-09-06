import { describe, expect, it, vi } from 'vitest';
import { AxBalancer } from './balance.js';
import { AxMultiServiceRouter } from './multiservice.js';
import { ai } from './wrap.js';

const service = () =>
  ai({ name: 'openai', apiKey: 'test', config: { model: 'gpt-6-astra' } });
describe('session routing', () => {
  it('resolves an external router alias before opening one pinned session', async () => {
    const llm = service();
    const session = {
      model: 'gpt-6-astra',
      close() {},
      events: async function* () {},
      submitToolResults: async () => {},
      continue: async () => {},
      steer: async () => 'next-response' as const,
      setThinkingTokenBudget: async () => 'next-response' as const,
    };
    const open = vi.spyOn(llm, 'openChatSession').mockResolvedValue(session);
    const router = AxMultiServiceRouter.create([
      { key: 'smart', description: 'Astra', service: llm },
    ]);
    expect(router.getFeatures('smart').asyncTools).toBe(true);
    expect(
      await router.openChatSession({ model: 'smart', chatPrompt: [] })
    ).toBe(session);
    expect(open.mock.calls[0]?.[0].model).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
  });
  it('does not fail over if the selected session fails to open', async () => {
    const first = service();
    const second = service();
    const openFirst = vi
      .spyOn(first, 'openChatSession')
      .mockRejectedValue(new Error('Disconnected'));
    const openSecond = vi.spyOn(second, 'openChatSession');
    const balancer = new AxBalancer([first, second], {
      comparator: AxBalancer.inputOrderComparator,
    });
    expect(balancer.getFeatures().asyncTools).toBe(true);
    await expect(balancer.openChatSession({ chatPrompt: [] })).rejects.toThrow(
      'Disconnected'
    );
    expect(openFirst).toHaveBeenCalledTimes(1);
    expect(openSecond).not.toHaveBeenCalled();
  });
});
