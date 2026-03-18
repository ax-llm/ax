import { readFile, writeFile } from 'node:fs/promises';

import {
  type AxAgentEvalTask,
  type AxAgentFunction,
  AxAIGoogleGeminiModel,
  AxGen,
  AxJSRuntime,
  type AxOptimizationProgress,
  type AxOptimizationStats,
  AxOptimizedProgramImpl,
  agent,
  ai,
  axDefaultOptimizerLogger,
  f,
  fn,
  s,
} from '@ax-llm/ax';

const artifactPath = new URL('./rlm-agent-optimize.json', import.meta.url);
const today = '2026-03-16';
const tomorrow = '2026-03-17';
const googleApiKey = process.env.GOOGLE_APIKEY;

type OfficeInput = {
  today: string;
  query: string;
};

type Person = {
  name: string;
  email: string;
};

type ProjectStatus = {
  summary: string;
  owner: string;
  blocker: string;
  nextMilestone: string;
};

type CalendarEvent = {
  title: string;
  attendeeNames: string[];
  isoTime: string;
  durationMinutes: number;
};

type EmailMessage = {
  to: string[];
  subject: string;
  body: string;
};

type ToolCall = {
  qualifiedName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

type OfficeEnvironment = {
  tools: AxAgentFunction[];
  calendar: CalendarEvent[];
  sentEmails: EmailMessage[];
  drafts: EmailMessage[];
  callLog: ToolCall[];
  toolErrors: string[];
};

if (!googleApiKey) {
  console.error('GOOGLE_APIKEY is required');
  process.exit(1);
}

const studentAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini25FlashLite,
    temperature: 0.2,
  },
});

const teacherAI = ai({
  name: 'google-gemini',
  apiKey: googleApiKey!,
  config: {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    temperature: 0.2,
  },
});

const trainTasks: readonly AxAgentEvalTask<OfficeInput>[] = [
  {
    input: {
      today,
      query:
        'Tomorrow after 1pm, schedule a 45 minute Atlas blocker review with Bill and Dana. Then email Bill and Dana the exact meeting time plus the Atlas owner and blocker.',
    },
    criteria:
      'Use the available tools to resolve Bill and Dana, look up the Atlas status, find the earliest mutual slot tomorrow after 1pm, create the calendar event, and send an email that includes the exact meeting time, the Atlas owner, and the Atlas blocker.',
    expectedActions: [
      'contacts.resolvePeople',
      'projects.lookupProjectStatus',
      'calendar.findAvailability',
      'calendar.createEvent',
      'email.sendEmail',
    ],
  },
  {
    input: {
      today,
      query:
        'Draft Priya an Atlas delay update using the latest project summary and blocker, but do not send it.',
    },
    criteria:
      'Resolve Priya, inspect the Atlas project status, and save a draft email. The draft should mention the current summary and blocker. Do not send an email.',
    expectedActions: [
      'contacts.resolvePeople',
      'projects.lookupProjectStatus',
      'email.saveDraft',
    ],
    forbiddenActions: ['email.sendEmail'],
  },
  {
    input: {
      today,
      query: 'What is my first meeting today and who is attending?',
    },
    criteria:
      'Inspect the calendar for today before answering. Identify the earliest event and list its attendees. Do not send or draft email.',
    expectedActions: ['calendar.eventsOnDate'],
    forbiddenActions: ['email.sendEmail', 'email.saveDraft'],
  },
  {
    input: {
      today,
      query:
        'Who owns Atlas, what is blocking it, and what is the next milestone? Keep it to one short paragraph.',
    },
    criteria:
      'Inspect the Atlas project status and answer from the returned status fields. Do not schedule anything or send email.',
    expectedActions: ['projects.lookupProjectStatus'],
    forbiddenActions: [
      'calendar.createEvent',
      'email.sendEmail',
      'email.saveDraft',
    ],
  },
];

const validationTasks: readonly AxAgentEvalTask<OfficeInput>[] = [
  {
    input: {
      today,
      query:
        'Tomorrow after 3pm, set up a 30 minute Atlas owner sync with Dana and then email Priya the exact time. Do not email Dana.',
    },
    criteria:
      'Resolve Dana and Priya, find the earliest 30 minute slot tomorrow after 3pm, create the event, and send the confirmation only to Priya.',
    expectedActions: [
      'contacts.resolvePeople',
      'calendar.findAvailability',
      'calendar.createEvent',
      'email.sendEmail',
    ],
  },
  {
    input: {
      today,
      query: 'What is the first meeting on my calendar tomorrow?',
    },
    criteria:
      'Inspect the calendar for tomorrow before answering and identify the earliest event. Do not schedule anything or send email.',
    expectedActions: ['calendar.eventsOnDate'],
    forbiddenActions: [
      'calendar.createEvent',
      'email.sendEmail',
      'email.saveDraft',
    ],
  },
];

const showcaseTask: AxAgentEvalTask<OfficeInput> = {
  input: {
    today,
    query:
      'Tomorrow after 1pm, set up a 45 minute Atlas blocker review with Bill and Dana. Then send Priya a note with the exact meeting time, the Atlas owner, and the blocker. Do not email Bill or Dana.',
  },
  criteria:
    'Resolve the people involved, inspect the Atlas project status, find the earliest mutual 45 minute slot tomorrow after 1pm, create the event, and send exactly one email to Priya with the exact meeting time, owner, and blocker. Do not email Bill or Dana and do not save only a draft.',
  expectedActions: [
    'contacts.resolvePeople',
    'projects.lookupProjectStatus',
    'calendar.findAvailability',
    'calendar.createEvent',
    'email.sendEmail',
  ],
  forbiddenActions: ['email.saveDraft'],
};

const comparisonGen = new AxGen(
  s(`
    task:string "Office assistant task to complete",
    criteria:string "Success criteria for the task",
    candidateRun:json "Candidate run snapshot to review",
    baselineRun:json "Baseline run snapshot to compare against"
    ->
    reasoning:string "Short explanation of which run is better",
    winner:class "candidate, baseline, tie" "Which run is better overall"
  `)
);
comparisonGen.setInstruction(
  'Prefer runs that actually completed the office task through correct tools and side effects. Heavily penalize wrong recipients, missing project details, skipped scheduling, or claiming an action that was not performed.'
);

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function toIso(date: string, hour: number, minute = 0) {
  return `${date}T${pad(hour)}:${pad(minute)}:00-07:00`;
}

function formatLocalTime(isoTime: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Vancouver',
  }).format(new Date(isoTime));
}

function hasAnyAttendeeOverlap(
  left: readonly string[],
  right: readonly string[]
): boolean {
  const rightNames = new Set(right.map((name) => name.toLowerCase()));
  return left.some((name) => rightNames.has(name.toLowerCase()));
}

function overlaps(
  candidateIsoTime: string,
  durationMinutes: number,
  event: CalendarEvent
) {
  const candidateStart = new Date(candidateIsoTime).getTime();
  const candidateEnd = candidateStart + durationMinutes * 60_000;
  const eventStart = new Date(event.isoTime).getTime();
  const eventEnd = eventStart + event.durationMinutes * 60_000;

  return candidateStart < eventEnd && eventStart < candidateEnd;
}

function createOfficeEnvironment(): OfficeEnvironment {
  const contacts = new Map<string, Person>([
    ['bill', { name: 'Bill', email: 'bill@bigbasinlabs.com' }],
    ['dana', { name: 'Dana', email: 'dana@bigbasinlabs.com' }],
    ['priya', { name: 'Priya', email: 'priya@bigbasinlabs.com' }],
  ]);

  const projectStatus: Record<string, ProjectStatus> = {
    atlas: {
      summary:
        'Atlas launch is delayed by two days while the rollout checklist waits on QA sign-off.',
      owner: 'Dana',
      blocker: 'Final QA sign-off is still pending from the release checklist.',
      nextMilestone:
        'Ship the revised launch candidate after QA clears the checklist.',
    },
  };

  const calendar: CalendarEvent[] = [
    {
      title: 'Design Team Standup',
      attendeeNames: ['Bill', 'Dana'],
      isoTime: toIso(today, 9, 0),
      durationMinutes: 30,
    },
    {
      title: 'Atlas QA Sync',
      attendeeNames: ['Bill'],
      isoTime: toIso(tomorrow, 13, 0),
      durationMinutes: 30,
    },
    {
      title: 'Design Review',
      attendeeNames: ['Dana'],
      isoTime: toIso(tomorrow, 14, 0),
      durationMinutes: 60,
    },
    {
      title: 'Customer Prep',
      attendeeNames: ['Bill', 'Dana'],
      isoTime: toIso(tomorrow, 15, 30),
      durationMinutes: 30,
    },
  ];

  const sentEmails: EmailMessage[] = [];
  const drafts: EmailMessage[] = [];
  const callLog: ToolCall[] = [];
  const toolErrors: string[] = [];

  const recordSuccess = (
    qualifiedName: string,
    args: Record<string, unknown>,
    result: unknown
  ) => {
    callLog.push({ qualifiedName, arguments: args, result });
    return result;
  };

  const recordFailure = (
    qualifiedName: string,
    args: Record<string, unknown>,
    error: unknown
  ) => {
    const message = error instanceof Error ? error.message : String(error);
    callLog.push({ qualifiedName, arguments: args, error: message });
    toolErrors.push(message);
    throw error instanceof Error ? error : new Error(message);
  };

  const tools: AxAgentFunction[] = [
    fn('resolvePeople')
      .namespace('contacts')
      .description('Resolve people names into email addresses')
      .arg('names', f.string('Person name').array())
      .returns(
        f
          .object({
            name: f.string('Resolved name'),
            email: f.string('Resolved email'),
          })
          .array()
      )
      .handler(async ({ names }) => {
        const args = { names };
        try {
          const resolved = names.flatMap((name) => {
            const person = contacts.get(name.toLowerCase());
            return person ? [person] : [];
          });
          return recordSuccess('contacts.resolvePeople', args, resolved);
        } catch (error) {
          return recordFailure('contacts.resolvePeople', args, error);
        }
      })
      .build(),
    fn('lookupProjectStatus')
      .namespace('projects')
      .description(
        'Return the latest project status summary, owner, blocker, and next milestone'
      )
      .arg('project', f.string('Project name'))
      .returns(
        f.object({
          summary: f.string('Current project summary'),
          owner: f.string('Project owner'),
          blocker: f.string('Current blocker'),
          nextMilestone: f.string('Next milestone'),
        })
      )
      .handler(async ({ project }) => {
        const args = { project };
        try {
          const status = projectStatus[project.toLowerCase()];
          if (!status) {
            throw new Error(`No project status found for ${project}.`);
          }
          return recordSuccess('projects.lookupProjectStatus', args, status);
        } catch (error) {
          return recordFailure('projects.lookupProjectStatus', args, error);
        }
      })
      .build(),
    fn('findAvailability')
      .namespace('calendar')
      .description(
        'Find the earliest shared slot for the attendees on a date after a given hour'
      )
      .arg('attendeeNames', f.string('Attendee name').array())
      .arg('date', f.string('Date in YYYY-MM-DD format'))
      .arg('durationMinutes', f.number('Requested duration in minutes'))
      .arg('afterHour', f.number('Earliest local hour to consider'))
      .returns(
        f.object({
          isoTime: f.string('Suggested ISO datetime'),
          attendeeNames: f.string('Requested attendee names').array(),
        })
      )
      .handler(async ({ attendeeNames, date, durationMinutes, afterHour }) => {
        const args = { attendeeNames, date, durationMinutes, afterHour };
        try {
          for (let hour = afterHour; hour <= 17; hour++) {
            for (const minute of [0, 30]) {
              const candidateIsoTime = toIso(date, hour, minute);
              const candidateEnd =
                new Date(candidateIsoTime).getTime() + durationMinutes * 60_000;
              if (candidateEnd > new Date(toIso(date, 18, 0)).getTime()) {
                continue;
              }

              const hasConflict = calendar.some(
                (event) =>
                  event.isoTime.startsWith(date) &&
                  hasAnyAttendeeOverlap(event.attendeeNames, attendeeNames) &&
                  overlaps(candidateIsoTime, durationMinutes, event)
              );

              if (!hasConflict) {
                return recordSuccess('calendar.findAvailability', args, {
                  isoTime: candidateIsoTime,
                  attendeeNames,
                });
              }
            }
          }

          throw new Error(
            `No shared slot available for ${attendeeNames.join(', ')} on ${date}.`
          );
        } catch (error) {
          return recordFailure('calendar.findAvailability', args, error);
        }
      })
      .build(),
    fn('createEvent')
      .namespace('calendar')
      .description('Create a calendar event for a specific time')
      .arg('title', f.string('Event title'))
      .arg('attendeeNames', f.string('Attendee name').array())
      .arg('isoTime', f.string('Event time in ISO format'))
      .arg('durationMinutes', f.number('Event duration in minutes'))
      .returns(
        f.object({
          created: f.boolean('Whether the event was created'),
          title: f.string('Created event title'),
          isoTime: f.string('Created event time'),
        })
      )
      .handler(async ({ title, attendeeNames, isoTime, durationMinutes }) => {
        const args = { title, attendeeNames, isoTime, durationMinutes };
        try {
          calendar.push({ title, attendeeNames, isoTime, durationMinutes });
          const result = { created: true, title, isoTime };
          return recordSuccess('calendar.createEvent', args, result);
        } catch (error) {
          return recordFailure('calendar.createEvent', args, error);
        }
      })
      .build(),
    fn('eventsOnDate')
      .namespace('calendar')
      .description(
        'List all events scheduled on a given date in local time order'
      )
      .arg('date', f.string('Date in YYYY-MM-DD format'))
      .returns(
        f
          .object({
            title: f.string('Event title'),
            attendeeNames: f.string('Attendee name').array(),
            isoTime: f.string('Event start time'),
          })
          .array()
      )
      .handler(async ({ date }) => {
        const args = { date };
        try {
          const events = calendar
            .filter((event) => event.isoTime.startsWith(date))
            .sort((left, right) => left.isoTime.localeCompare(right.isoTime))
            .map((event) => ({
              title: event.title,
              attendeeNames: event.attendeeNames,
              isoTime: event.isoTime,
            }));
          return recordSuccess('calendar.eventsOnDate', args, events);
        } catch (error) {
          return recordFailure('calendar.eventsOnDate', args, error);
        }
      })
      .build(),
    fn('sendEmail')
      .namespace('email')
      .description('Send an email immediately')
      .arg('to', f.string('Recipient email address').array())
      .arg('subject', f.string('Email subject line'))
      .arg('body', f.string('Email body text'))
      .returns(
        f.object({
          sent: f.boolean('Whether the email was sent'),
          recipientCount: f.number('Number of recipients'),
        })
      )
      .handler(async ({ to, subject, body }) => {
        const args = { to, subject, body };
        try {
          sentEmails.push({ to, subject, body });
          const result = { sent: true, recipientCount: to.length };
          return recordSuccess('email.sendEmail', args, result);
        } catch (error) {
          return recordFailure('email.sendEmail', args, error);
        }
      })
      .build(),
    fn('saveDraft')
      .namespace('email')
      .description('Save an email draft without sending it')
      .arg('to', f.string('Recipient email address').array())
      .arg('subject', f.string('Email subject line'))
      .arg('body', f.string('Email body text'))
      .returns(
        f.object({
          saved: f.boolean('Whether the draft was saved'),
          recipientCount: f.number('Number of recipients'),
        })
      )
      .handler(async ({ to, subject, body }) => {
        const args = { to, subject, body };
        try {
          drafts.push({ to, subject, body });
          const result = { saved: true, recipientCount: to.length };
          return recordSuccess('email.saveDraft', args, result);
        } catch (error) {
          return recordFailure('email.saveDraft', args, error);
        }
      })
      .build(),
  ];

  return {
    tools,
    calendar,
    sentEmails,
    drafts,
    callLog,
    toolErrors,
  };
}

function buildCoordinator(env: OfficeEnvironment) {
  const coordinator = agent('today:string, query:string -> answer:string', {
    ai: studentAI,
    judgeAI: teacherAI,
    contextFields: ['today'],
    runtime: new AxJSRuntime(),
    functions: { local: env.tools },
    maxTurns: 8,
    contextPolicy: {
      preset: 'adaptive',
      state: {
        summary: true,
        inspect: true,
        maxEntries: 8,
      },
      checkpoints: {
        enabled: true,
        triggerChars: 10_000,
      },
    },
    actorOptions: {
      description:
        'You are the operations coordinator for Big Basin Labs. Use tools instead of guessing. Respect relative dates using the provided today field. Prefer direct tool calls and simple runtime JavaScript for scheduling, project status, and email tasks. When the task says draft only, save a draft and do not send. When the task forbids emailing someone, do not include them as recipients. Do not ask for clarification if the needed information can be gathered from tools.',
      model: AxAIGoogleGeminiModel.Gemini25FlashLite,
      modelConfig: { temperature: 0.2, maxTokens: 420 },
    },
    responderOptions: {
      description:
        'Reply in crisp operational language. Mention exact scheduled times, recipients, and whether you sent an email or saved only a draft. Never claim an action that a tool did not complete.',
      model: AxAIGoogleGeminiModel.Gemini25FlashLite,
      modelConfig: { temperature: 0.2, maxTokens: 220 },
    },
    judgeOptions: {
      description:
        'Prefer actual task completion over polished prose. Reward correct tool choice, correct recipients, exact scheduled times, and grounded project details. Penalize missing required tool use, wrong recipients, needless retries, or claiming actions that were not performed.',
      model: AxAIGoogleGeminiModel.Gemini3Pro,
      modelConfig: { temperature: 0.2 },
    },
  });

  coordinator.setDemos([
    {
      programId: 'root.actor' as const,
      traces: [
        {
          query: 'What is my first meeting today and who is attending?',
          actionLog: '(no actions yet)',
          javascriptCode:
            'const events = await calendar.eventsOnDate({ date: inputs.today }); console.log(events);',
        },
        {
          query:
            'Draft Priya an Atlas delay update using the latest project summary and blocker, but do not send it.',
          actionLog: '(no actions yet)',
          javascriptCode: `const [people, status] = await Promise.all([
  contacts.resolvePeople({ names: ['Priya'] }),
  projects.lookupProjectStatus({ project: 'Atlas' }),
]);
const priya = people[0];
await email.saveDraft({
  to: [priya.email],
  subject: 'Atlas delay update',
  body: \`Atlas is currently delayed. Summary: \${status.summary} Blocker: \${status.blocker}\`,
});
final('Saved an Atlas delay-update draft to Priya without sending it.');`,
        },
        {
          query:
            'Tomorrow after 1pm, schedule a 45 minute Atlas blocker review with Bill and Dana.',
          actionLog: '(no actions yet)',
          javascriptCode: `const attendees = await contacts.resolvePeople({ names: ['Bill', 'Dana'] });
const slot = await calendar.findAvailability({
  attendeeNames: attendees.map((person) => person.name),
  date: '${tomorrow}',
  durationMinutes: 45,
  afterHour: 13,
});
await calendar.createEvent({
  title: 'Atlas blocker review',
  attendeeNames: attendees.map((person) => person.name),
  isoTime: slot.isoTime,
  durationMinutes: 45,
});
final(\`Scheduled the Atlas blocker review for \${slot.isoTime}.\`);`,
        },
        {
          query:
            'Tomorrow after 3pm, set up a 30 minute Atlas owner sync with Dana and then email Priya the exact time. Do not email Dana.',
          actionLog: '(no actions yet)',
          javascriptCode: `const people = await contacts.resolvePeople({ names: ['Dana', 'Priya'] });
const dana = people.find((person) => person.name === 'Dana');
const priya = people.find((person) => person.name === 'Priya');
const slot = await calendar.findAvailability({
  attendeeNames: [dana.name],
  date: '${tomorrow}',
  durationMinutes: 30,
  afterHour: 15,
});
await calendar.createEvent({
  title: 'Atlas owner sync',
  attendeeNames: [dana.name],
  isoTime: slot.isoTime,
  durationMinutes: 30,
});
await email.sendEmail({
  to: [priya.email],
  subject: 'Atlas owner sync scheduled',
  body: \`The Atlas owner sync with Dana is scheduled for \${slot.isoTime}.\`,
});
final('Scheduled the Atlas owner sync and emailed Priya the exact time.');`,
        },
      ],
    },
    {
      programId: 'root.responder' as const,
      traces: [
        {
          query: 'What is my first meeting today and who is attending?',
          answer:
            'Your first meeting today is Design Team Standup at 9:00 AM with Bill and Dana.',
        },
      ],
    },
  ]);

  return coordinator;
}

function buildRunSnapshot(answer: string, env: OfficeEnvironment) {
  return {
    answer,
    functionCalls: env.callLog,
    sentEmails: env.sentEmails,
    drafts: env.drafts,
    calendarEvents: env.calendar.map((event) => ({
      title: event.title,
      attendeeNames: event.attendeeNames,
      isoTime: event.isoTime,
      durationMinutes: event.durationMinutes,
    })),
    toolErrors: env.toolErrors,
  };
}

function printRun(label: string, answer: string, env: OfficeEnvironment) {
  console.log(`\n=== ${label} ===`);
  console.log(answer);

  console.log('\nFunction calls:');
  for (const call of env.callLog) {
    const resultText = call.error
      ? `error=${call.error}`
      : `result=${JSON.stringify(call.result)}`;
    console.log(
      `- ${call.qualifiedName} args=${JSON.stringify(call.arguments)} ${resultText}`
    );
  }

  console.log('\nSent emails:');
  if (env.sentEmails.length === 0) {
    console.log('- none');
  } else {
    for (const email of env.sentEmails) {
      console.log(`- to=${email.to.join(', ')} subject=${email.subject}`);
    }
  }

  console.log('\nDrafts:');
  if (env.drafts.length === 0) {
    console.log('- none');
  } else {
    for (const draft of env.drafts) {
      console.log(`- to=${draft.to.join(', ')} subject=${draft.subject}`);
    }
  }

  console.log('\nCalendar tail:');
  for (const event of env.calendar.slice(-3)) {
    console.log(
      `- ${event.title} @ ${formatLocalTime(event.isoTime)} with ${event.attendeeNames.join(', ')}`
    );
  }
}

console.log('RLM agent optimization with a real office-assistant task set');
console.log('Student: Gemini 2.5 Flash Lite');
console.log('Judge/teacher: Gemini 3 Pro');
console.log(`Today context: ${today}`);

const baselineEnv = createOfficeEnvironment();
const baselineAgent = buildCoordinator(baselineEnv);
const baselineRun = await baselineAgent.forward(studentAI, showcaseTask.input);
printRun('Baseline run before optimization', baselineRun.answer, baselineEnv);

const trainingEnv = createOfficeEnvironment();
const trainingAgent = buildCoordinator(trainingEnv);

console.log('\nStarting GEPA optimization with live status...\n');
console.log(
  'Optimize rollouts start from a clean continuation state, and clarification outcomes are scored directly without invoking the responder.'
);

const optimizationResult = await trainingAgent.optimize(
  {
    train: trainTasks,
    validation: validationTasks,
  },
  {
    target: 'actor',
    maxMetricCalls: 28,
    verbose: true,
    optimizerLogger: axDefaultOptimizerLogger,
    onProgress: (progress: Readonly<AxOptimizationProgress>) => {
      console.log(
        `[progress] round ${progress.round}/${progress.totalRounds} current=${progress.currentScore.toFixed(3)} best=${progress.bestScore.toFixed(3)}`
      );
    },
    onEarlyStop: (reason: string, stats: Readonly<AxOptimizationStats>) => {
      console.log(`[early-stop] ${reason} best=${stats.bestScore.toFixed(3)}`);
    },
  }
);

if (!optimizationResult.optimizedProgram) {
  throw new Error('Optimization did not return an optimized program.');
}

console.log('\nOptimization finished.');
console.log(`Best score: ${optimizationResult.bestScore.toFixed(3)}`);

await writeFile(
  artifactPath,
  JSON.stringify(optimizationResult.optimizedProgram, null, 2),
  'utf8'
);
console.log(`Saved optimized artifact to ${artifactPath.pathname}`);

const restoredProgram = new AxOptimizedProgramImpl(
  JSON.parse(await readFile(artifactPath, 'utf8'))
);

const optimizedEnv = createOfficeEnvironment();
const optimizedAgent = buildCoordinator(optimizedEnv);
optimizedAgent.applyOptimization(restoredProgram);

const optimizedRun = await optimizedAgent.forward(
  studentAI,
  showcaseTask.input
);
printRun(
  'Restored optimized agent on the same hard task',
  optimizedRun.answer,
  optimizedEnv
);

const comparison = await comparisonGen.forward(
  teacherAI,
  {
    task: showcaseTask.input.query,
    criteria: showcaseTask.criteria,
    candidateRun: buildRunSnapshot(optimizedRun.answer, optimizedEnv),
    baselineRun: buildRunSnapshot(baselineRun.answer, baselineEnv),
  },
  {
    model: AxAIGoogleGeminiModel.Gemini3Pro,
    modelConfig: { temperature: 0.2 },
    maxSteps: 1,
  }
);

console.log('\nJudge comparison on the held-out task:');
console.log(`Winner: ${comparison.winner}`);
console.log(comparison.reasoning);

const replayEnv = createOfficeEnvironment();
const replayAgent = buildCoordinator(replayEnv);
replayAgent.applyOptimization(restoredProgram);

const replayTask = validationTasks[1]!;
const replayRun = await replayAgent.forward(studentAI, replayTask.input);
printRun('Fresh restored agent on a second task', replayRun.answer, replayEnv);
