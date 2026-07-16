import { choice } from './helpers.mjs';
import { dspyUnit } from './units/01-dspy.mjs';
import { modelsSignaturesUnit } from './units/02-models-signatures.mjs';
import { axgenUnit } from './units/03-axgen.mjs';
import { axflowUnit } from './units/04-axflow.mjs';
import { axagentUnit } from './units/05-axagent.mjs';
import { rlmUnit } from './units/06-rlm.mjs';
import { peekContextUnit } from './units/07-peek-context.mjs';
import { optimizationUnit } from './units/08-optimization.mjs';
import { mcpUnit } from './units/09-mcp.mjs';
import { notificationsUnit } from './units/10-notifications.mjs';
import { productionUnit } from './units/11-production.mjs';

const units = [
  dspyUnit,
  modelsSignaturesUnit,
  axgenUnit,
  axflowUnit,
  axagentUnit,
  rlmUnit,
  peekContextUnit,
  optimizationUnit,
  mcpUnit,
  notificationsUnit,
  productionUnit,
];

const allTopicIds = units.flatMap((unit) => unit.topics.map(({ id }) => id));

export const academyCourse = {
  id: 'ax-foundations',
  version: 2,
  schemaVersion: 1,
  language: 'typescript',
  title: 'Ax Academy',
  courseTitle: 'Build reliable AI workflows and agents',
  description:
    'A hands-on TypeScript course for building dependable AI features, multi-step workflows, tool-using agents, and production automation.',
  dailyGoal: 20,
  units,
  finalCapstone: {
    id: 'production-incident-agent',
    title: 'Build a production incident-response agent',
    prerequisites: [
      'rlm-semantic-helpers',
      'repeated-corpus-exploration',
      'gepa-pareto-artifacts',
      'playbook-learning',
      'mcp-tasks-advanced',
      'task-continuation-security',
      'security-and-languages',
    ],
    summary:
      'Combine everything into an agent that investigates a large incident, uses external tools, waits safely for live updates, and proves its recommendations improved. AxFlow owns the fixed phases, AxAgent handles the investigation, and the runtime keeps long context and resumptions under control.',
    steps: [
      'Create the typed incident and resolution contracts.',
      'Use a Flow for intake, investigation, approval, and response phases.',
      'Keep the incident log runtime-only and add a persisted context map.',
      'Attach recorded MCP tools and an identity-aware event source.',
      'Observe progress, wake on an authorized resource update, and resume only the owned task continuation.',
      'Evaluate the baseline, apply an optimization artifact, and compare held-out results.',
    ],
    command: 'npm run tsx src/examples/mcp-event-demo-server.ts',
    exercises: [
      choice(
        'Which component should own the fixed intake → investigate → approve → respond order?',
        ['AxFlow', 'The MCP notification callback', 'A context map'],
        0,
        'The host-owned workflow belongs in AxFlow.'
      ),
      choice(
        'Which component should preserve orientation across repeated investigations of the same system?',
        [
          'AxAgentContextMap',
          'A progress notification',
          'The final output field',
        ],
        0,
        'A context map holds compact reusable orientation.'
      ),
      choice(
        'What may resume a remote task continuation?',
        [
          'A terminal or input-required event matching its verified owner',
          'Any catalog change',
          'Every logging notification',
        ],
        0,
        'Resume is identity- and correlation-scoped.'
      ),
    ].map((exercise, index) => ({
      ...exercise,
      id: `production-incident-agent-${index + 1}`,
      roles: ['capstone'],
    })),
  },
  coverage: {
    'ax-ai': [
      'ai-providers-models',
      'media-audio-thinking',
      'routing-fallback',
    ],
    'ax-audio': ['media-audio-thinking'],
    'ax-signature': ['signature-semantic-contract', 'fluent-fields-validation'],
    'ax-gen': [
      'ax-forward',
      'structured-validation-errors',
      'streaming-assertions',
    ],
    'ax-flow': ['flow-state-nodes', 'flow-control', 'flow-operations'],
    'ax-agent': ['agent-core', 'agent-discovery', 'child-agents'],
    'ax-agent-rlm': [
      'rlm-pipeline',
      'context-policies',
      'rlm-semantic-helpers',
    ],
    'ax-agent-context': ['agent-context-observability', 'peek-orientation'],
    'ax-agent-memory-skills': [
      'context-map-lifecycle',
      'memory-recall',
      'skill-discovery',
    ],
    'ax-agent-observability': [
      'agent-context-observability',
      'production-observability',
    ],
    'ax-agent-optimize': ['evals-metrics-judges', 'agent-optimize'],
    'ax-gepa': ['optimize-gen-flow', 'gepa-pareto-artifacts'],
    'ax-playbook': ['playbook-learning'],
    'ax-refine': ['refine-selection'],
    'ax-mcp': ['mcp-lifecycle-transports', 'mcp-catalog', 'mcp-tasks-advanced'],
    'ax-event-runtime': [
      'event-runtime-core',
      'event-actions',
      'task-continuation-security',
    ],
  },
  topicOrder: allTopicIds,
};

export const requiredAcademyCoverage = Object.keys(academyCourse.coverage);
