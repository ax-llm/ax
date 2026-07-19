import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildAcademyPages,
  validateAcademyCourse,
  validateAcademyLanguages,
} from '../../scripts/website-academy.mjs';
import {
  academyCourse,
  requiredAcademyCoverage,
} from '../content-src/academy/course.mjs';
import {
  applyCapstoneResult,
  applyCheckpointResult,
  applyDiagnosticAnswer,
  applyPracticeAnswer,
  applyReviewResult,
  capstoneReady,
  checkpointExerciseSet,
  checkpointReady,
  courseStats,
  createProgress,
  dailyReviewSet,
  dayStreak,
  evaluateExercise,
  exercisesForRole,
  MAX_STABILITY,
  migrateProgress,
  pickExercise,
  recommendedTasks,
  reviewExerciseSet,
  reviewForecast,
  reviewPassed,
  selectDiagnosticTopic,
  shuffledChoiceOrder,
  storageKey,
  topicStatus,
} from '../static/js/academy-engine.js';

const now = Date.parse('2026-07-15T12:00:00.000Z');
const languageIds = ['typescript', 'python', 'java', 'cpp', 'go', 'rust'];

async function readLanguages() {
  return Promise.all(
    languageIds.map(async (languageId) =>
      JSON.parse(
        await readFile(
          `website/content-src/languages/${languageId}.json`,
          'utf8'
        )
      )
    )
  );
}

test('course schema is complete, acyclic, source-backed, and export-valid', async () => {
  const source = await readFile('src/ax/index.ts', 'utf8');
  const publicExports = new Set(
    [...source.matchAll(/^export (?:type )?\{([^}]+)\};/gm)].flatMap((match) =>
      match[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    )
  );
  const result = await validateAcademyCourse(academyCourse, {
    repoRoot: process.cwd(),
    publicExports,
    requiredCoverage: requiredAcademyCoverage,
  });
  assert.deepEqual(result, { topicCount: 54, unitCount: 11 });
  assert.equal(new Set(academyCourse.topicOrder).size, 54);
  const topics = academyCourse.units.flatMap((unit) => unit.topics);
  assert.deepEqual(
    [
      Math.min(...topics.map((topic) => topic.minutes)),
      Math.max(...topics.map((topic) => topic.minutes)),
    ],
    [5, 12]
  );
  assert.ok(new Set(topics.map((topic) => topic.minutes)).size >= 7);
  assert.ok(
    topics.filter((topic) => topic.exampleSteps.length > 0).length >= 15
  );
  assert.ok(topics.some((topic) => topic.exampleSteps.length === 0));
  assert.ok(
    topics.every(
      (topic) =>
        topic.summary.split(/[.!?](?:\s|$)/).filter(Boolean).length <= 2
    )
  );
  for (const topic of topics) {
    assert.equal(exercisesForRole(topic, 'diagnostic').length, 1);
    assert.equal(exercisesForRole(topic, 'practice').length, 2);
    assert.equal(exercisesForRole(topic, 'review').length, 2);
    assert.equal(
      new Set(topic.exercises.map((exercise) => exercise.prompt)).size,
      topic.exercises.length
    );
  }
});

test('every supported language generates a native, complete Academy', async () => {
  const languages = await readLanguages();
  const result = await validateAcademyLanguages(academyCourse, languages, {
    repoRoot: process.cwd(),
  });
  assert.deepEqual(result, { languageCount: 6 });

  for (const language of languages) {
    const pages = buildAcademyPages(academyCourse, language);
    assert.equal(pages.length, 69);
    assert.ok(
      pages.every((page) => page.relPath.startsWith(`${language.id}/academy/`))
    );
    assert.ok(pages.every((page) => page.page.language === language.id));
    const firstLesson = pages.find((page) =>
      page.relPath.includes('/topics/programs-not-prompts/')
    );
    assert.ok(
      firstLesson.page.body.includes(`\"language\":\"${language.id}\"`)
    );
    if (language.id !== 'typescript') {
      assert.ok(!firstLesson.page.body.includes('const classify ='));
    }
    assert.ok(firstLesson.page.body.includes('In your own project'));
    assert.ok(firstLesson.page.body.includes('In the ax repo'));
    assert.ok(firstLesson.page.body.includes('From a clone of the ax repo:'));
    assert.ok(firstLesson.page.body.includes('OPENAI_APIKEY'));
    assert.ok(firstLesson.page.body.includes('academy-api-chip">ax()'));
    assert.ok(firstLesson.page.body.includes('Source on GitHub'));
    assert.ok(!firstLesson.page.body.includes('src/ax/skills/'));
    const dashboard = pages[0].page.body;
    assert.equal(pages[0].page.title, academyCourse.courseTitle);
    assert.ok(dashboard.includes(`<h1>${academyCourse.courseTitle}.</h1>`));
    assert.ok(dashboard.includes('data-academy-up-next'));
    assert.ok(
      dashboard.includes(
        '<p class="academy-up-next-guidance">Start small. Your queue adapts as you learn.</p>'
      )
    );
    assert.ok(dashboard.includes('~6 hours · saved in this browser'));
    assert.ok(dashboard.includes('academy-api-chip">ax()'));
    assert.equal((dashboard.match(/<details/g) ?? []).length, 11);
    assert.equal(
      (dashboard.match(/<details class="academy-unit"[^>]* open/g) ?? [])
        .length,
      1
    );
    const diagnostic = pages.find((page) =>
      page.relPath.includes('/academy/diagnostic/')
    );
    assert.ok(
      diagnostic.page.body.includes('New to ax? Skip the quiz — start Lesson 1')
    );
    const manifestBytes = Buffer.byteLength(pages[0].page.body, 'utf8');
    assert.ok(manifestBytes > 100_000);
    assert.ok(manifestBytes < 180_000);
  }
});

test('lesson presentation aligns breadcrumbs and hides unused feedback', async () => {
  const css = await readFile('website/static/css/site.css', 'utf8');
  assert.match(
    css,
    /\.academy-breadcrumb\s*\{[^}]*width:\s*min\(100%, 62rem\)[^}]*margin:\s*0 auto 2rem/s
  );
  assert.match(css, /\.academy-feedback\[hidden\]\s*\{[^}]*display:\s*none/s);
});

test('language Academies keep progress in separate storage namespaces', async () => {
  const languages = await readLanguages();
  const manifests = languages.map((language) => {
    const page = buildAcademyPages(academyCourse, language)[0];
    const json = page.page.body.match(
      /<script type="application\/json" id="academy-course-data" data-pagefind-ignore>(.*)<\/script>/
    )?.[1];
    return JSON.parse(json);
  });
  assert.equal(new Set(manifests.map(storageKey)).size, languageIds.length);
});

test('progress creation and migration preserve matching topics and discard stale state', () => {
  const progress = createProgress(academyCourse, now);
  progress.topics['programs-not-prompts'].stability = 2;
  progress.topics.removed = { stability: 4 };
  progress.dailyGoal = 30;
  progress.courseVersion = 1;
  const exportedV1 = JSON.parse(JSON.stringify(progress));
  const migrated = migrateProgress(academyCourse, exportedV1, now + 1_000);
  assert.equal(migrated.topics['programs-not-prompts'].stability, 2);
  assert.equal(migrated.topics.removed, undefined);
  assert.equal(migrated.dailyGoal, 30);
  assert.equal(migrated.courseVersion, 2);
  assert.match(storageKey(academyCourse), /typescript:ax-foundations$/);
  progress.topics['programs-not-prompts'].stability = 99;
  assert.equal(
    migrateProgress(academyCourse, progress, now).topics['programs-not-prompts']
      .stability,
    MAX_STABILITY
  );
});

test('diagnostic selection is deterministic and correct answers place ancestors provisionally', () => {
  const progress = createProgress(academyCourse, now);
  const first = selectDiagnosticTopic(academyCourse, progress);
  assert.ok(first);
  assert.equal(selectDiagnosticTopic(academyCourse, progress).id, first.id);

  const placed = applyDiagnosticAnswer(
    academyCourse,
    progress,
    'rlm-semantic-helpers',
    true,
    now
  );
  assert.equal(placed.topics['rlm-semantic-helpers'].stability, 1);
  assert.equal(placed.topics['rlm-semantic-helpers'].provisional, false);
  assert.equal(placed.topics['rlm-pipeline'].stability, 1);
  assert.equal(placed.topics['rlm-pipeline'].provisional, true);
  assert.equal(placed.totalXP, 0);
});

test('a failed diagnostic answer removes inferred descendant credit and queues repair', () => {
  let progress = createProgress(academyCourse, now);
  progress = applyDiagnosticAnswer(
    academyCourse,
    progress,
    'rlm-semantic-helpers',
    true,
    now
  );
  assert.equal(progress.topics['persistent-runtime-state'].provisional, true);
  progress = applyDiagnosticAnswer(
    academyCourse,
    progress,
    'rlm-pipeline',
    false,
    now + 1_000
  );
  assert.equal(progress.topics['rlm-pipeline'].needsRemediation, true);
  assert.equal(progress.topics['persistent-runtime-state'].stability, 0);
});

test('two consecutive correct practice answers establish mastery and award XP', () => {
  let progress = createProgress(academyCourse, now);
  let result = applyPracticeAnswer(
    academyCourse,
    progress,
    'programs-not-prompts',
    true,
    now
  );
  assert.equal(result.mastered, false);
  progress = result.progress;
  result = applyPracticeAnswer(
    academyCourse,
    progress,
    'programs-not-prompts',
    true,
    now + 1_000
  );
  assert.equal(result.mastered, true);
  assert.equal(result.progress.topics['programs-not-prompts'].stability, 1);
  assert.equal(result.progress.totalXP, 5);
  assert.equal(
    topicStatus(
      academyCourse,
      result.progress,
      'programs-not-prompts',
      now + 2_000
    ),
    'mastered'
  );
});

test('mastered practice cannot be farmed for more XP', () => {
  const progress = createProgress(academyCourse, now);
  progress.topics['programs-not-prompts'].stability = 1;
  progress.totalXP = 9;
  const result = applyPracticeAnswer(
    academyCourse,
    progress,
    'programs-not-prompts',
    true,
    now
  );
  assert.equal(result.xpAwarded, 0);
  assert.equal(result.progress.totalXP, 9);
});

test('an incorrect practice answer breaks the streak and queues remediation', () => {
  let progress = createProgress(academyCourse, now);
  progress = applyPracticeAnswer(
    academyCourse,
    progress,
    'programs-not-prompts',
    true,
    now
  ).progress;
  progress = applyPracticeAnswer(
    academyCourse,
    progress,
    'programs-not-prompts',
    false,
    now + 1_000
  ).progress;
  assert.equal(progress.topics['programs-not-prompts'].correctStreak, 0);
  assert.equal(progress.topics['programs-not-prompts'].needsRemediation, true);
});

test('successful and failed reviews adjust stability and intervals', () => {
  let progress = createProgress(academyCourse, now);
  progress.topics['programs-not-prompts'].stability = 1;
  progress = applyReviewResult(
    academyCourse,
    progress,
    'programs-not-prompts',
    2,
    3,
    now
  );
  assert.equal(progress.topics['programs-not-prompts'].stability, 2);
  assert.equal(
    progress.topics['programs-not-prompts'].nextReviewAt,
    '2026-07-18T12:00:00.000Z'
  );
  progress = applyReviewResult(
    academyCourse,
    progress,
    'programs-not-prompts',
    1,
    3,
    now + 1_000
  );
  assert.equal(progress.topics['programs-not-prompts'].stability, 1);
  assert.equal(progress.topics['programs-not-prompts'].needsRemediation, true);
});

test('reviews graduate to the 50-day ladder and hold very overdue stability', () => {
  let progress = createProgress(academyCourse, now);
  progress.topics['programs-not-prompts'].stability = 4;
  progress.topics['programs-not-prompts'].nextReviewAt = new Date(
    now
  ).toISOString();
  progress = applyReviewResult(
    academyCourse,
    progress,
    'programs-not-prompts',
    3,
    3,
    now
  );
  assert.equal(progress.topics['programs-not-prompts'].stability, 5);
  assert.equal(
    progress.topics['programs-not-prompts'].nextReviewAt,
    '2026-09-03T12:00:00.000Z'
  );

  progress.topics['programs-not-prompts'].stability = 3;
  progress.topics['programs-not-prompts'].nextReviewAt = new Date(
    now - 15 * 86_400_000
  ).toISOString();
  progress = applyReviewResult(
    academyCourse,
    progress,
    'programs-not-prompts',
    3,
    3,
    now
  );
  assert.equal(progress.topics['programs-not-prompts'].stability, 3);
  assert.equal(
    progress.topics['programs-not-prompts'].nextReviewAt,
    '2026-07-22T12:00:00.000Z'
  );
});

test('review answers compress direct prerequisite repetitions in both directions', () => {
  let progress = createProgress(academyCourse, now);
  for (const topicId of [
    'typed-contracts-everywhere',
    'ai-providers-models',
    'fluent-fields-validation',
    'programs-not-prompts',
  ]) {
    progress.topics[topicId].stability = 2;
    progress.topics[topicId].nextReviewAt = new Date(
      now + 86_400_000
    ).toISOString();
  }
  const ancestorBefore = progress.topics['programs-not-prompts'].nextReviewAt;
  progress = applyReviewResult(
    academyCourse,
    progress,
    'typed-contracts-everywhere',
    3,
    3,
    now
  );
  assert.equal(
    progress.topics['ai-providers-models'].nextReviewAt,
    new Date(now + 1.5 * 86_400_000).toISOString()
  );
  assert.equal(
    progress.topics['fluent-fields-validation'].nextReviewAt,
    new Date(now + 1.5 * 86_400_000).toISOString()
  );
  assert.equal(
    progress.topics['programs-not-prompts'].nextReviewAt,
    ancestorBefore
  );

  progress.topics['ai-providers-models'].nextReviewAt = new Date(
    now + 10 * 86_400_000
  ).toISOString();
  progress = applyReviewResult(
    academyCourse,
    progress,
    'typed-contracts-everywhere',
    0,
    3,
    now
  );
  assert.equal(
    progress.topics['ai-providers-models'].nextReviewAt,
    new Date(now + 86_400_000).toISOString()
  );
});

test('review pass threshold is shared and review pools exclude unlearned topics', () => {
  const progress = createProgress(academyCourse, now);
  progress.topics['programs-not-prompts'].stability = 1;
  progress.topics['signature-semantic-contract'].stability = 1;
  const exercises = reviewExerciseSet(
    academyCourse,
    progress,
    'signature-semantic-contract'
  );
  assert.equal(reviewPassed(2, 3), true);
  assert.equal(reviewPassed(1, 3), false);
  assert.deepEqual(
    exercises.map((exercise) => exercise.topicId),
    ['signature-semantic-contract', 'programs-not-prompts']
  );
  assert.ok(
    exercises.every(
      (exercise) =>
        exercise.topicId === 'signature-semantic-contract' ||
        progress.topics[exercise.topicId].stability > 0
    )
  );
});

test('checkpoint failures return missed knowledge points to the queue', () => {
  const progress = createProgress(academyCourse, now);
  const unit = academyCourse.units[0];
  for (const topic of unit.topics) progress.topics[topic.id].stability = 1;
  assert.equal(checkpointReady(academyCourse, progress, unit.id), true);
  const exercises = checkpointExerciseSet(academyCourse, unit.id);
  const answers = exercises.map((exercise, index) => ({
    topicId: exercise.topicId,
    correct: index < 2,
  }));
  const outcome = applyCheckpointResult(
    academyCourse,
    progress,
    unit.id,
    answers,
    now
  );
  assert.equal(outcome.passed, false);
  assert.equal(
    outcome.progress.topics[answers.at(-1).topicId].needsRemediation,
    true
  );
});

test('passed checkpoints and completed capstones award no retake XP', () => {
  const progress = createProgress(academyCourse, now);
  const unit = academyCourse.units[0];
  progress.checkpoints[unit.id] = {
    passed: true,
    bestScore: 5,
    completedAt: new Date(now).toISOString(),
  };
  progress.capstone.completed = true;
  progress.totalXP = 20;
  const answers = unit.topics.map((topic) => ({
    topicId: topic.id,
    correct: true,
  }));
  const checkpoint = applyCheckpointResult(
    academyCourse,
    progress,
    unit.id,
    answers,
    now
  );
  assert.equal(checkpoint.progress.totalXP, 20);
  const capstone = applyCapstoneResult(checkpoint.progress, 3, now);
  assert.equal(capstone.progress.totalXP, 20);
});

test('recommended tasks include placement and an unlocked first lesson without duplicates', () => {
  const progress = createProgress(academyCourse, now);
  const tasks = recommendedTasks(academyCourse, progress, now);
  assert.equal(tasks[0].type, 'diagnostic');
  assert.ok(tasks.some((task) => task.id === 'programs-not-prompts'));
  assert.equal(
    new Set(tasks.map((task) => `${task.type}:${task.id}`)).size,
    tasks.length
  );
});

test('due reviews aggregate into one interleaved daily task', () => {
  const progress = createProgress(academyCourse, now);
  const dueIds = [
    'programs-not-prompts',
    'examples-metrics-loop',
    'ai-providers-models',
  ];
  for (const [index, topicId] of dueIds.entries()) {
    progress.topics[topicId].stability = 1;
    progress.topics[topicId].nextReviewAt = new Date(
      now - index - 1
    ).toISOString();
  }
  const tasks = recommendedTasks(academyCourse, progress, now);
  const reviews = tasks.filter((task) => task.type === 'review');
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].id, 'daily-review');
  assert.equal(reviews[0].href, '/typescript/academy/review/');

  const exercises = dailyReviewSet(academyCourse, progress, now);
  assert.deepEqual(
    exercises.map((exercise) => exercise.topicId),
    ['ai-providers-models', 'examples-metrics-loop', 'programs-not-prompts']
  );
});

test('streak and seven-day review forecast are derived from saved progress', () => {
  const progress = createProgress(academyCourse, now);
  progress.xpByDay['2026-07-13'] = 4;
  progress.xpByDay['2026-07-14'] = 2;
  assert.equal(dayStreak(progress, now), 2);
  progress.xpByDay['2026-07-15'] = 1;
  assert.equal(dayStreak(progress, now), 3);

  progress.topics['programs-not-prompts'].stability = 1;
  progress.topics['programs-not-prompts'].nextReviewAt = new Date(
    now - 1
  ).toISOString();
  progress.topics['examples-metrics-loop'].stability = 1;
  progress.topics['examples-metrics-loop'].nextReviewAt = new Date(
    now + 86_400_000
  ).toISOString();
  const forecast = reviewForecast(academyCourse, progress, now);
  assert.equal(forecast.length, 7);
  assert.equal(forecast[0].count, 1);
  assert.equal(forecast[1].count, 1);
});

test('capstone requires every named prerequisite and completes only on a perfect architecture check', () => {
  const progress = createProgress(academyCourse, now);
  assert.equal(capstoneReady(academyCourse, progress), false);
  for (const topicId of academyCourse.finalCapstone.prerequisites) {
    progress.topics[topicId].stability = 1;
  }
  assert.equal(capstoneReady(academyCourse, progress), true);
  let outcome = applyCapstoneResult(progress, 2, now);
  assert.equal(outcome.passed, false);
  outcome = applyCapstoneResult(outcome.progress, 3, now + 1_000);
  assert.equal(outcome.passed, true);
  assert.equal(outcome.progress.capstone.completed, true);
});

test('choice and code exercises grade deterministically', () => {
  const choiceExercise = academyCourse.units[0].topics[0].exercises[0];
  const codeExercise = academyCourse.units[0].topics[2].exercises[0];
  assert.equal(evaluateExercise(choiceExercise, '0'), true);
  assert.equal(evaluateExercise(choiceExercise, '1'), false);
  assert.equal(evaluateExercise(codeExercise, 's()'), true);
  assert.equal(evaluateExercise(codeExercise, 'ax'), false);
});

test('role pools expose every exercise and rotate deterministically by salt', () => {
  const topic = structuredClone(academyCourse.units[0].topics[0]);
  const extra = {
    ...topic.exercises[1],
    id: `${topic.id}-practice-2`,
    prompt: 'A second practice decision',
  };
  topic.exercises.push(extra);
  assert.equal(exercisesForRole(topic, 'practice').length, 3);
  assert.equal(
    pickExercise(topic, 'practice', 'day-1').id,
    pickExercise(topic, 'practice', 'day-1').id
  );
  assert.ok(
    new Set(
      Array.from(
        { length: 20 },
        (_, salt) => pickExercise(topic, 'practice', salt).id
      )
    ).size > 1
  );
});

test('choice shuffling is seeded, deterministic, and preserves original indexes', () => {
  const exercise = academyCourse.units[0].topics[0].exercises[0];
  const first = shuffledChoiceOrder(exercise, 'attempt-1');
  assert.deepEqual(first, shuffledChoiceOrder(exercise, 'attempt-1'));
  assert.deepEqual([...first].sort(), [0, 1, 2]);
  const variants = new Set(
    Array.from({ length: 12 }, (_, index) =>
      shuffledChoiceOrder(exercise, `attempt-${index}`).join(',')
    )
  );
  assert.ok(variants.size > 1);
  assert.deepEqual(shuffledChoiceOrder({ type: 'code' }, 'attempt'), []);
});

test('course validation rejects choice answers outside the authored index-zero convention', async () => {
  const source = await readFile('src/ax/index.ts', 'utf8');
  const publicExports = new Set(
    [...source.matchAll(/^export (?:type )?\{([^}]+)\};/gm)].flatMap((match) =>
      match[1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    )
  );
  const invalid = structuredClone(academyCourse);
  invalid.units[0].topics[0].exercises[0].answer = 1;
  await assert.rejects(
    validateAcademyCourse(invalid, {
      repoRoot: process.cwd(),
      publicExports,
      requiredCoverage: requiredAcademyCoverage,
    }),
    /authored answer at index 0/
  );

  const missingQuestionSymbol = structuredClone(academyCourse);
  const signatureTopic = missingQuestionSymbol.units
    .flatMap((unit) => unit.topics)
    .find((topic) => topic.id === 'string-signatures');
  signatureTopic.apiSymbols = signatureTopic.apiSymbols.filter(
    (symbol) => symbol !== 'ai'
  );
  await assert.rejects(
    validateAcademyCourse(missingQuestionSymbol, {
      repoRoot: process.cwd(),
      publicExports,
      requiredCoverage: requiredAcademyCoverage,
    }),
    /names public API ai without listing it in apiSymbols/
  );
});

test('course statistics separate learned, durable, due, and daily XP', () => {
  const progress = createProgress(academyCourse, now);
  progress.topics['programs-not-prompts'].stability = 2;
  progress.topics['programs-not-prompts'].nextReviewAt = new Date(
    now - 1
  ).toISOString();
  progress.totalXP = 12;
  progress.xpByDay['2026-07-15'] = 12;
  const stats = courseStats(academyCourse, progress, now);
  assert.equal(stats.learned, 1);
  assert.equal(stats.durable, 1);
  assert.equal(stats.due, 1);
  assert.equal(stats.todayXP, 12);
});
