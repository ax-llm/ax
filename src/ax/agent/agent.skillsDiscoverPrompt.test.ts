import { describe, expect, it } from 'vitest';
import { AxMockAIService } from '../ai/mock/api.js';
import {
  AX_HOST_SNIPPET_MARKER,
  AX_INPUTS_PATCH_GLOBAL,
} from './agentInternal/sharedSession.js';
import type { AxAgentCatalogSkill } from './agentInternal/skillsTypes.js';
import { agent } from './index.js';
import type { AxCodeRuntime } from './rlm.js';

// The executor prompt advertises discover({ skills }) only when the runtime's
// discover takes skills: a skills search callback, or a catalog's built-in
// one. Preset skills or skill usage tracking alone leave it out, since the
// runtime has no discover for them.

const SKILLS_OVERLOAD =
  'await discover(request: { skills: string | string[] }): void';
const MIXED_OVERLOAD =
  'await discover(request: { tools?: string | string[], skills?: string | string[] }): void';
const TOOLS_OVERLOAD = 'await discover(item: string): void';

const PRESET: AxAgentCatalogSkill[] = [
  {
    id: 'refunds',
    name: 'Refund policy',
    description: 'How refunds work',
    content: 'Refunds settle in 30 days; quote the policy.',
  },
];

type Run = {
  executorSystem: string;
  // Whether the executor's runtime session has a discover global.
  runtimeHasDiscover: boolean;
};

async function runAgent(options: Record<string, unknown>): Promise<Run> {
  let runtimeHasDiscover = false;
  const runtime: AxCodeRuntime = {
    getUsageInstructions: () => '',
    createSession(globals) {
      return {
        execute: async (code: string) => {
          if (code.startsWith(AX_HOST_SNIPPET_MARKER)) return 'host-snippet';
          runtimeHasDiscover = typeof globals?.discover === 'function';
          await (globals!.final as (...args: unknown[]) => Promise<void>)(
            'Answer the question',
            {}
          );
          return 'done';
        },
        patchGlobals: async (patch: Record<string, unknown>) => {
          const { [AX_INPUTS_PATCH_GLOBAL]: staged, ...rest } = patch;
          Object.assign(globals ?? {}, rest);
          if (globals && staged && typeof staged === 'object') {
            globals.inputs = Object.assign(
              (globals.inputs as Record<string, unknown>) ?? {},
              staged
            );
          }
        },
        close: () => {},
      };
    },
  };
  let executorSystem = '';
  const ai = new AxMockAIService({
    features: { functions: false, streaming: false },
    chatResponse: async (req) => {
      const system = String(req.chatPrompt[0]?.content ?? '');
      if (system.includes('You (`executor`)')) executorSystem = system;
      const content =
        system.includes('You (`executor`)') ||
        system.includes('You (`distiller`)')
          ? 'Javascript Code: await final("Answer the question", {})'
          : 'Answer: Refunds take 30 days.';
      return {
        results: [{ index: 0, content, finishReason: 'stop' as const }],
      };
    },
  });
  const ag = agent('question:string -> answer:string', {
    directResponse: 'off',
    runtime,
    ...options,
  } as never);
  await ag.forward(ai as never, { question: 'How long do refunds take?' });
  return { executorSystem, runtimeHasDiscover };
}

describe('executor prompt: discover({ skills }) follows the runtime', () => {
  it('leaves it out for preset skills only, keeping Loaded Skills', async () => {
    const run = await runAgent({ skills: PRESET });
    expect(run.runtimeHasDiscover).toBe(false);
    expect(run.executorSystem).toContain('### Loaded Skills');
    expect(run.executorSystem).not.toContain(SKILLS_OVERLOAD);
    expect(run.executorSystem).not.toContain('await discover(');
  });

  it('leaves it out for skill usage tracking without a search', async () => {
    const run = await runAgent({ skills: PRESET, onUsedSkills: () => {} });
    expect(run.runtimeHasDiscover).toBe(false);
    expect(run.executorSystem).not.toContain(SKILLS_OVERLOAD);
    expect(run.executorSystem).toContain('await used(');
  });

  it('keeps it for a skills catalog', async () => {
    const run = await runAgent({ skills: PRESET, skillsCatalog: PRESET });
    expect(run.runtimeHasDiscover).toBe(true);
    expect(run.executorSystem).toContain(SKILLS_OVERLOAD);
  });

  it('keeps only the tools overloads with function discovery and preset skills', async () => {
    const run = await runAgent({
      skills: PRESET,
      functionDiscovery: true,
      functions: [
        {
          namespace: 'db',
          title: 'Database',
          selectionCriteria: 'Customer records',
          functions: [
            {
              name: 'lookup',
              description: 'Look up a customer by id',
              parameters: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
              },
              func: async () => ({}),
            },
          ],
        },
      ],
    });
    expect(run.runtimeHasDiscover).toBe(true);
    expect(run.executorSystem).toContain(TOOLS_OVERLOAD);
    expect(run.executorSystem).not.toContain(MIXED_OVERLOAD);
    expect(run.executorSystem).not.toContain(SKILLS_OVERLOAD);
  });
});
