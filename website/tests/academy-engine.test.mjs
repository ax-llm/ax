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
  evaluateExercise,
  migrateProgress,
  recommendedTasks,
  selectDiagnosticTopic,
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
  assert.deepEqual(result, { topicCount: 53, unitCount: 11 });
  assert.equal(new Set(academyCourse.topicOrder).size, 53);
});

test('every supported language generates a native, complete Academy', async () => {
  const languages = await readLanguages();
  const result = await validateAcademyLanguages(academyCourse, languages, {
    repoRoot: process.cwd(),
  });
  assert.deepEqual(result, { languageCount: 6 });

  for (const language of languages) {
    const pages = buildAcademyPages(academyCourse, language);
    assert.equal(pages.length, 67);
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
  }
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
  const migrated = migrateProgress(academyCourse, progress, now + 1_000);
  assert.equal(migrated.topics['programs-not-prompts'].stability, 2);
  assert.equal(migrated.topics.removed, undefined);
  assert.equal(migrated.dailyGoal, 30);
  assert.match(storageKey(academyCourse), /typescript:ax-foundations$/);
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
  progress = applyReviewResult(progress, 'programs-not-prompts', 2, 3, now);
  assert.equal(progress.topics['programs-not-prompts'].stability, 2);
  assert.equal(
    progress.topics['programs-not-prompts'].nextReviewAt,
    '2026-07-18T12:00:00.000Z'
  );
  progress = applyReviewResult(
    progress,
    'programs-not-prompts',
    1,
    3,
    now + 1_000
  );
  assert.equal(progress.topics['programs-not-prompts'].stability, 1);
  assert.equal(progress.topics['programs-not-prompts'].needsRemediation, true);
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
  const outcome = applyCheckpointResult(progress, unit.id, answers, now);
  assert.equal(outcome.passed, false);
  assert.equal(
    outcome.progress.topics[answers.at(-1).topicId].needsRemediation,
    true
  );
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
