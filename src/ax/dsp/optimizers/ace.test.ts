import { describe, expect, it, vi } from 'vitest';
import type { AxAIService } from '../../ai/types.js';
import { f } from '../sig.js';
import { ax } from '../template.js';
import {
  AxACE,
  isAceNoOpAcknowledgment,
  normalizeReflectionBulletTags,
} from './ace.js';
import { applyCuratorOperations, createEmptyPlaybook } from './acePlaybook.js';
import type {
  AxACECuratorOperation,
  AxACEPlaybook,
  AxACEReflectionOutput,
} from './aceTypes.js';

function buildPlaybook(sections: Record<string, string[]>): AxACEPlaybook {
  const playbook = createEmptyPlaybook();
  for (const [section, contents] of Object.entries(sections)) {
    playbook.sections[section] = contents.map((content, index) => ({
      id: `${section.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${index}`,
      section,
      content,
      helpfulCount: index,
      harmfulCount: 0,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
  }
  return playbook;
}

const reflectionOutput: AxACEReflectionOutput = {
  reasoning: 'mock reflection',
  errorIdentification: 'no error',
  rootCauseAnalysis: 'none',
  correctApproach: 'keep going',
  keyInsight: 'stable behavior',
  bulletTags: [],
};

function createACEProgram() {
  return ax(
    f().input('question', f.string()).output('answer', f.string()).build()
  );
}

describe('AxACE helpers', () => {
  it('resolves curator operation targets using reflection tags', () => {
    const optimizer = Object.create(AxACE.prototype) as AxACE;

    const playbook = buildPlaybook({
      Guidelines: ['Keep reasoning explicit'],
      'Common Pitfalls': ['Missing policy hints'],
    });

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Common Pitfalls',
        content: 'Mention missing policy hints',
      },
    ];

    const reflection: AxACEReflectionOutput = {
      reasoning: 'Missed policy hints',
      errorIdentification: 'Omitted policy hints',
      rootCauseAnalysis: 'No emphasis on hints',
      correctApproach: 'Include hints explicitly',
      keyInsight: 'Policy hints matter',
      bulletTags: [
        { id: 'common-pitfalls-0', tag: 'harmful' },
        { id: 'guidelines-0', tag: 'neutral' },
      ],
    };

    const resolved = (optimizer as any).resolveCuratorOperationTargets(
      operations,
      playbook,
      reflection,
      undefined
    ) as AxACECuratorOperation[];

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.bulletId).toBe('common-pitfalls-0');
  });

  it('drops operations when no matching bullet exists in section', () => {
    const optimizer = Object.create(AxACE.prototype) as AxACE;

    const playbook = buildPlaybook({
      Guidelines: ['Keep reasoning explicit'],
    });

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Common Pitfalls',
        content: 'Mention missing policy hints',
      },
    ];

    const resolved = (optimizer as any).resolveCuratorOperationTargets(
      operations,
      playbook,
      undefined,
      undefined
    ) as AxACECuratorOperation[];

    expect(resolved).toHaveLength(0);
  });

  it('protects updated bullets from auto prune', () => {
    const playbook = buildPlaybook({
      'Response Strategies': ['Primary tactic', 'Fallback tactic'],
    });

    const operations: AxACECuratorOperation[] = [
      {
        type: 'UPDATE',
        section: 'Response Strategies',
        bulletId: 'response-strategies-0',
        content: 'Primary tactic refined',
      },
      {
        type: 'ADD',
        section: 'Response Strategies',
        content: 'Third tactic',
      },
    ];

    const result = applyCuratorOperations(playbook, operations, {
      maxSectionSize: 2,
      enableAutoPrune: true,
      protectedBulletIds: new Set(['response-strategies-0']),
    });

    expect(result.autoRemoved).toHaveLength(1);
    expect(result.autoRemoved[0]?.bulletId).toBe('response-strategies-1');

    const remainingIds = playbook.sections['Response Strategies'].map(
      (bullet) => bullet.id
    );
    expect(remainingIds).toContain('response-strategies-0');
    expect(remainingIds).not.toContain('response-strategies-1');
    const newBullet = playbook.sections['Response Strategies'].find(
      (bullet) => bullet.id !== 'response-strategies-0'
    );
    expect(newBullet?.content).toBe('Third tactic');
  });
});

describe('isAceNoOpAcknowledgment', () => {
  const noOps = [
    'No update required. Keep the existing routing rule to team gamma unchanged.',
    'No update required.',
    'No change needed.',
    'No changes required.',
    'No further action needed.',
    'No new rule needed.',
    'No additional changes are necessary.',
    'Nothing to add.',
    'Nothing needs to change.',
    'Keep the existing routing rule to team gamma unchanged.',
    'Leave the existing guidance in place.',
    'Retain the existing rule as is.',
    'The existing escalation rule remains correct.',
    'The current guidance remains unchanged.',
    'No-op.',
    'NO UPDATE REQUIRED.',
  ];

  for (const content of noOps) {
    it(`flags no-op acknowledgment: ${content}`, () => {
      expect(isAceNoOpAcknowledgment(content)).toBe(true);
    });
  }

  const realRules = [
    'Route refund requests to team gamma.',
    'Always cite your sources.',
    // Legit prohibition rules: "no <subject>" without a no-op qualifier.
    'No change to the schema without a migration.',
    'No new dependencies without review.',
    'No action should bypass authentication.',
    // "keep the existing ..." that introduces substantive guidance (no stasis).
    'Keep the existing format but also append a confidence score.',
    // "remains correct" without a playbook referent.
    'Ensure the output remains correct after refactoring.',
    'Preserve the user original casing.',
    '',
  ];

  for (const content of realRules) {
    it(`keeps substantive content: ${content || '(empty)'}`, () => {
      expect(isAceNoOpAcknowledgment(content)).toBe(false);
    });
  }
});

describe('AxACE curator no-op filtering', () => {
  it('normalizeCuratorOperations drops no-op ADD acknowledgments only', () => {
    const optimizer = Object.create(AxACE.prototype) as AxACE;

    const operations = (optimizer as any).normalizeCuratorOperations([
      {
        type: 'ADD',
        section: 'Routing',
        content: 'Route refund requests to team gamma.',
      },
      {
        type: 'ADD',
        section: 'Routing',
        content:
          'No update required. Keep the existing routing rule to team gamma unchanged.',
      },
      {
        type: 'ADD',
        section: 'Routing',
        content: 'The existing escalation rule remains correct.',
      },
      // ADD-only: an UPDATE that happens to read like an acknowledgment is left
      // alone (it edits an existing bullet rather than creating filler).
      {
        type: 'UPDATE',
        section: 'Routing',
        bulletId: 'routing-1',
        content: 'No update required.',
      },
    ]);

    expect(operations).toHaveLength(2);
    expect(operations.map((op: any) => op.type)).toEqual(['ADD', 'UPDATE']);
    expect(operations[0].content).toBe('Route refund requests to team gamma.');
  });

  it('compile keeps only substantive curator bullets', async () => {
    const program = createACEProgram();
    vi.spyOn(program, 'forward').mockResolvedValue({ answer: 'prediction' });

    const ace = new AxACE(
      { studentAI: {} as any, teacherAI: {} as any },
      { maxEpochs: 1, maxReflectorRounds: 1 }
    );

    const reflectorProgram = (ace as any).getOrCreateReflectorProgram();
    vi.spyOn(reflectorProgram, 'forward').mockResolvedValue(reflectionOutput);

    const curatorProgram = (ace as any).getOrCreateCuratorProgram();
    vi.spyOn(curatorProgram, 'forward')
      .mockResolvedValueOnce({
        reasoning: 'Add the real rule; the rest is unchanged.',
        operations: [
          {
            type: 'ADD',
            section: 'Routing',
            content: 'Route refund requests to team gamma.',
          },
          {
            type: 'ADD',
            section: 'Routing',
            content:
              'No update required. Keep the existing routing rule to team gamma unchanged.',
          },
          {
            type: 'ADD',
            section: 'Routing',
            content: 'The existing escalation rule remains correct.',
          },
        ],
      })
      .mockResolvedValueOnce({ reasoning: 'no-op', operations: [] });

    const metric = vi.fn().mockReturnValue(1);

    await ace.compile(
      program,
      [
        { question: 'q1', answer: 'a1' },
        { question: 'q2', answer: 'a2' },
      ],
      metric
    );

    expect(
      ace.getPlaybook().sections.Routing?.map((bullet) => bullet.content)
    ).toEqual(['Route refund requests to team gamma.']);
  });
});

describe('AxACE', () => {
  it('runCurator should only receive input fields in question_context', async () => {
    const mockCuratorAI = {
      name: 'mockCurator',
      chat: vi.fn().mockResolvedValue({
        results: [
          {
            index: 0,
            content: '{"reasoning": "mock", "operations":[]}',
          },
        ],
      }),
      getOptions: () => ({ tracer: undefined }),
      getLogger: () => undefined,
    } as unknown as AxAIService;

    const program = ax(
      f().input('question', f.string()).output('answer', f.string()).build()
    );

    const example = {
      question: 'This is the input',
      answer: 'This is the output',
    };

    const ace = new AxACE({
      studentAI: {} as any,
      teacherAI: mockCuratorAI,
    });

    const curatorProgram = (ace as any).getOrCreateCuratorProgram();
    const forwardSpy = vi.spyOn(curatorProgram, 'forward');

    // Directly call the internal runCurator method for a focused unit test
    await (ace as any).runCurator({
      program,
      example,
      reflection: { keyInsight: 'test' }, // Minimal reflection to trigger curator
      playbook: { sections: {}, stats: { bulletCount: 0 } },
    });

    expect(forwardSpy).toHaveBeenCalled();

    const forwardArgs = forwardSpy.mock.calls[0][1] as any;
    const receivedContext = JSON.parse(forwardArgs.question_context);

    expect(receivedContext).toBeDefined();
    expect(receivedContext).toHaveProperty('question');
    expect(receivedContext.question).toBe('This is the input');
    expect(receivedContext).not.toHaveProperty('answer');
  });

  it('runReflector receives input context and generic expected output fields', async () => {
    const program = createACEProgram();
    const example = {
      question: 'This is the input',
      answer: 'This is the output',
      severity: 'critical',
      policyHint: 'domain-specific baggage',
    };

    const ace = new AxACE({
      studentAI: {} as any,
      teacherAI: {} as any,
    });
    ace.hydrate(program);

    const reflectorProgram = (ace as any).getOrCreateReflectorProgram();
    const forwardSpy = vi
      .spyOn(reflectorProgram, 'forward')
      .mockResolvedValue(reflectionOutput);

    await (ace as any).runReflector({
      example,
      generatorOutput: {
        reasoning: '',
        answer: { answer: 'Predicted output' },
        bulletIds: [],
      },
    });

    expect(forwardSpy).toHaveBeenCalled();

    const forwardArgs = forwardSpy.mock.calls[0][1] as any;
    const question = JSON.parse(forwardArgs.question);
    const expectedAnswer = JSON.parse(forwardArgs.expected_answer);

    expect(question).toEqual({ question: 'This is the input' });
    expect(expectedAnswer).toEqual({ answer: 'This is the output' });
    expect(expectedAnswer).not.toHaveProperty('severity');
    expect(expectedAnswer).not.toHaveProperty('policyHint');
  });

  it('compiling twice does not leak the previous playbook', async () => {
    const program = createACEProgram();
    vi.spyOn(program, 'forward').mockResolvedValue({ answer: 'prediction' });

    const ace = new AxACE(
      {
        studentAI: {} as any,
        teacherAI: {} as any,
      },
      { maxEpochs: 1, maxReflectorRounds: 1 }
    );

    const reflectorProgram = (ace as any).getOrCreateReflectorProgram();
    vi.spyOn(reflectorProgram, 'forward').mockResolvedValue(reflectionOutput);

    const curatorProgram = (ace as any).getOrCreateCuratorProgram();
    vi.spyOn(curatorProgram, 'forward')
      .mockResolvedValueOnce({
        reasoning: 'first',
        operations: [
          { type: 'ADD', section: 'Guidelines', content: 'first compile' },
        ],
      })
      .mockResolvedValueOnce({
        reasoning: 'first no-op',
        operations: [],
      })
      .mockResolvedValueOnce({
        reasoning: 'second',
        operations: [
          { type: 'ADD', section: 'Guidelines', content: 'second compile' },
        ],
      })
      .mockResolvedValueOnce({
        reasoning: 'second no-op',
        operations: [],
      });

    const metric = vi.fn().mockReturnValue(1);

    await ace.compile(
      program,
      [
        { question: 'q1', answer: 'a1' },
        { question: 'q1b', answer: 'a1b' },
      ],
      metric
    );
    expect(
      ace.getPlaybook().sections.Guidelines?.map((bullet) => bullet.content)
    ).toEqual(['first compile']);

    await ace.compile(
      program,
      [
        { question: 'q2', answer: 'a2' },
        { question: 'q2b', answer: 'a2b' },
      ],
      metric
    );

    expect(
      ace.getPlaybook().sections.Guidelines?.map((bullet) => bullet.content)
    ).toEqual(['second compile']);
  });

  it('records online update deltas in artifact history', async () => {
    const program = createACEProgram();
    const ace = new AxACE({
      studentAI: {} as any,
      teacherAI: {} as any,
    });
    ace.hydrate(program);

    const reflectorProgram = (ace as any).getOrCreateReflectorProgram();
    vi.spyOn(reflectorProgram, 'forward').mockResolvedValue(reflectionOutput);

    const curatorProgram = (ace as any).getOrCreateCuratorProgram();
    vi.spyOn(curatorProgram, 'forward').mockResolvedValue({
      reasoning: 'online',
      operations: [
        { type: 'ADD', section: 'Guidelines', content: 'online update' },
      ],
    });

    await ace.applyOnlineUpdate({
      example: { question: 'q', answer: 'a' },
      prediction: { answer: 'bad' },
      feedback: 'User corrected the answer.',
    });

    expect(ace.getArtifact().history).toMatchObject([
      {
        source: 'online',
        epoch: -1,
        exampleIndex: 0,
        operations: [
          { type: 'ADD', section: 'Guidelines', content: 'online update' },
        ],
      },
    ]);
  });

  it('returns artifacts without leaking nested mutable state', async () => {
    const program = createACEProgram();
    const ace = new AxACE({
      studentAI: {} as any,
      teacherAI: {} as any,
    });
    ace.hydrate(program);

    const reflectorProgram = (ace as any).getOrCreateReflectorProgram();
    vi.spyOn(reflectorProgram, 'forward').mockResolvedValue(reflectionOutput);

    const curatorProgram = (ace as any).getOrCreateCuratorProgram();
    vi.spyOn(curatorProgram, 'forward').mockResolvedValue({
      reasoning: 'online',
      operations: [
        { type: 'ADD', section: 'Guidelines', content: 'original update' },
      ],
    });

    await ace.applyOnlineUpdate({
      example: { question: 'q', answer: 'a' },
      prediction: { answer: 'bad' },
    });

    const artifact = ace.getArtifact();
    artifact.playbook.sections.Guidelines![0]!.content = 'mutated';
    artifact.history[0]!.operations[0]!.content = 'mutated';

    const freshArtifact = ace.getArtifact();

    expect(freshArtifact.playbook.sections.Guidelines?.[0]?.content).toBe(
      'original update'
    );
    expect(freshArtifact.history[0]?.operations[0]?.content).toBe(
      'original update'
    );
  });

  it('stores bounded input/output trajectory fields', () => {
    const program = ax(
      f()
        .input('question', f.string())
        .input('metadata', f.json())
        .output('answer', f.string())
        .build()
    );
    const ace = new AxACE(
      {
        studentAI: {} as any,
        teacherAI: {} as any,
      },
      { maxSerializedFieldChars: 24 }
    );

    const generatorOutput = (ace as any).createGeneratorOutput(
      {
        answer: 'predicted answer that is much longer than the limit',
        scratchpad: 'do not persist this private prediction field',
      },
      {
        question: 'question text that is much longer than the limit',
        metadata: {
          keep: 'metadata text that is much longer than the limit',
          nested: { value: 'nested value that is much longer than the limit' },
        },
        answer: 'expected answer that is much longer than the limit',
        unusedContext: 'do not persist this private example field',
      },
      program
    );

    const trajectory = JSON.parse(generatorOutput.trajectory);

    expect(trajectory.input.question).toHaveLength(24);
    expect(trajectory.input.metadata).toHaveLength(24);
    expect(trajectory.expectedOutput.answer).toHaveLength(24);
    expect(trajectory.prediction.answer).toHaveLength(24);
    expect(trajectory.input).not.toHaveProperty('unusedContext');
    expect(trajectory.prediction).not.toHaveProperty('scratchpad');
  });

  it('does not mark repeated trajectory references as circular', () => {
    const program = ax(
      f()
        .input('first', f.json())
        .input('second', f.json())
        .output('answer', f.string())
        .build()
    );
    const ace = new AxACE({
      studentAI: {} as any,
      teacherAI: {} as any,
    });
    const shared = { value: 'shared' };

    const generatorOutput = (ace as any).createGeneratorOutput(
      { answer: 'ok' },
      {
        first: shared,
        second: shared,
        answer: 'ok',
      },
      program
    );

    const trajectory = JSON.parse(generatorOutput.trajectory);

    expect(trajectory.input.first).toEqual({ value: 'shared' });
    expect(trajectory.input.second).toEqual({ value: 'shared' });
  });
});

describe('normalizeReflectionBulletTags', () => {
  const base = {
    reasoning: 'r',
    errorIdentification: 'e',
    rootCauseAnalysis: 'rc',
    correctApproach: 'c',
    keyInsight: 'k',
  };

  it('passes proper arrays through and keeps undefined reflections', () => {
    const tags = [{ id: 'a-1', tag: 'helpful' as const }];
    expect(
      normalizeReflectionBulletTags({ ...base, bulletTags: tags })?.bulletTags
    ).toEqual(tags);
    expect(normalizeReflectionBulletTags(undefined)).toBeUndefined();
  });

  it('wraps a single-object bulletTags into an array (model quirk)', () => {
    const reflection = normalizeReflectionBulletTags({
      ...base,
      bulletTags: { id: 'a-1', tag: 'harmful' } as any,
    });
    expect(reflection?.bulletTags).toEqual([{ id: 'a-1', tag: 'harmful' }]);
    for (const tag of reflection?.bulletTags ?? []) {
      expect(tag.id).toBe('a-1');
    }
  });

  it('drops malformed entries instead of throwing downstream', () => {
    const reflection = normalizeReflectionBulletTags({
      ...base,
      bulletTags: 'not tags' as any,
    });
    expect(reflection?.bulletTags).toEqual([]);
    expect(
      normalizeReflectionBulletTags({
        ...base,
        bulletTags: [{ id: 1 }, null, { id: 'ok', tag: 'neutral' }] as any,
      })?.bulletTags
    ).toEqual([{ id: 'ok', tag: 'neutral' }]);
  });
});
