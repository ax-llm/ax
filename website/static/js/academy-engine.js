export const ACADEMY_STORAGE_PREFIX = 'ax-academy';
export const REVIEW_INTERVAL_DAYS = [0, 1, 3, 7, 21, 50];
export const MAX_STABILITY = 5;
export const MIN_DIAGNOSTIC_QUESTIONS = 12;
export const MAX_DIAGNOSTIC_QUESTIONS = 15;

function hashSeed(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffledChoiceOrder(exercise, seedString) {
  if (exercise?.type !== 'choice') return [];
  const order = exercise.choices.map((_, index) => index);
  const random = mulberry32(hashSeed(seedString));
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

export function storageKey(course) {
  return `${ACADEMY_STORAGE_PREFIX}:v${course.schemaVersion}:${course.language}:${course.id}`;
}

export function createProgress(course, now = Date.now()) {
  const topics = {};
  for (const topic of allTopics(course)) topics[topic.id] = emptyTopicState();
  return {
    schemaVersion: course.schemaVersion,
    courseVersion: course.version,
    courseId: course.id,
    dailyGoal: course.dailyGoal,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    diagnostic: {
      status: 'not-started',
      asked: [],
      results: {},
      completedAt: null,
    },
    topics,
    checkpoints: {},
    capstone: { completed: false, completedAt: null, bestScore: 0 },
    xpByDay: {},
    totalXP: 0,
  };
}

function emptyTopicState() {
  return {
    stability: 0,
    correctStreak: 0,
    attempts: 0,
    nextReviewAt: null,
    lastAnsweredAt: null,
    masteredAt: null,
    needsRemediation: false,
    provisional: false,
  };
}

export function migrateProgress(course, input, now = Date.now()) {
  const fresh = createProgress(course, now);
  if (!input || typeof input !== 'object' || input.courseId !== course.id) {
    return fresh;
  }

  fresh.dailyGoal = normalizeGoal(input.dailyGoal, course.dailyGoal);
  fresh.createdAt = validIso(input.createdAt) ?? fresh.createdAt;
  fresh.totalXP = nonNegativeNumber(input.totalXP);
  fresh.xpByDay = cleanXpDays(input.xpByDay);

  const validTopicIds = new Set(course.topicOrder);
  for (const topicId of validTopicIds) {
    fresh.topics[topicId] = normalizeTopicState(input.topics?.[topicId]);
  }

  const asked = Array.isArray(input.diagnostic?.asked)
    ? input.diagnostic.asked.filter((topicId) => validTopicIds.has(topicId))
    : [];
  const results = {};
  for (const topicId of asked) {
    if (typeof input.diagnostic?.results?.[topicId] === 'boolean') {
      results[topicId] = input.diagnostic.results[topicId];
    }
  }
  fresh.diagnostic = {
    status: ['not-started', 'in-progress', 'complete'].includes(
      input.diagnostic?.status
    )
      ? input.diagnostic.status
      : 'not-started',
    asked: [...new Set(asked)],
    results,
    completedAt: validIso(input.diagnostic?.completedAt),
  };

  const validUnitIds = new Set(course.units.map((unit) => unit.id));
  for (const [unitId, checkpoint] of Object.entries(input.checkpoints ?? {})) {
    if (!validUnitIds.has(unitId)) continue;
    fresh.checkpoints[unitId] = {
      passed: Boolean(checkpoint?.passed),
      bestScore: clampNumber(checkpoint?.bestScore, 0, 5),
      completedAt: validIso(checkpoint?.completedAt),
    };
  }

  fresh.capstone = {
    completed: Boolean(input.capstone?.completed),
    completedAt: validIso(input.capstone?.completedAt),
    bestScore: clampNumber(input.capstone?.bestScore, 0, 3),
  };
  fresh.updatedAt = new Date(now).toISOString();
  return fresh;
}

function normalizeTopicState(input) {
  const state = emptyTopicState();
  if (!input || typeof input !== 'object') return state;
  state.stability = clampNumber(input.stability, 0, MAX_STABILITY);
  state.correctStreak = clampNumber(input.correctStreak, 0, 5);
  state.attempts = nonNegativeNumber(input.attempts);
  state.nextReviewAt = validIso(input.nextReviewAt);
  state.lastAnsweredAt = validIso(input.lastAnsweredAt);
  state.masteredAt = validIso(input.masteredAt);
  state.needsRemediation = Boolean(input.needsRemediation);
  state.provisional = Boolean(input.provisional) && state.stability > 0;
  return state;
}

export function evaluateExercise(exercise, submitted) {
  if (!exercise) return false;
  if (exercise.type === 'choice') return Number(submitted) === exercise.answer;
  if (exercise.type === 'code') {
    const accepted = [exercise.answer, ...(exercise.alternatives ?? [])].map(
      normalizeCodeAnswer
    );
    return accepted.includes(normalizeCodeAnswer(submitted));
  }
  return false;
}

function normalizeCodeAnswer(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('`', '')
    .replace(/[();]/g, '')
    .replace(/\s+/g, '');
}

export function topicStatus(course, progress, topicId, now = Date.now()) {
  const topic = topicById(course, topicId);
  const state = progress.topics?.[topicId] ?? emptyTopicState();
  if (!topic) return 'locked';
  if (state.stability > 0) {
    if (state.nextReviewAt && Date.parse(state.nextReviewAt) <= now) {
      return 'review';
    }
    return state.provisional ? 'provisional' : 'mastered';
  }
  const unlocked = topic.prerequisites.every(
    (prerequisite) => (progress.topics?.[prerequisite]?.stability ?? 0) > 0
  );
  if (!unlocked) return 'locked';
  if (state.attempts > 0 || state.needsRemediation) return 'learning';
  return 'ready';
}

export function courseStats(course, progress, now = Date.now()) {
  let learned = 0;
  let durable = 0;
  let due = 0;
  for (const topic of allTopics(course)) {
    const state = progress.topics[topic.id];
    if (state.stability > 0) learned += 1;
    if (state.stability >= 2) durable += 1;
    if (topicStatus(course, progress, topic.id, now) === 'review') due += 1;
  }
  return {
    total: course.topicOrder.length,
    learned,
    durable,
    due,
    percent: Math.round(
      (learned / Math.max(1, course.topicOrder.length)) * 100
    ),
    todayXP: progress.xpByDay[dayKey(now)] ?? 0,
  };
}

export function selectDiagnosticTopic(course, progress) {
  if (progress.diagnostic.asked.length >= MAX_DIAGNOSTIC_QUESTIONS) return null;
  const asked = new Set(progress.diagnostic.asked);
  const unitAsked = new Map();
  for (const topicId of asked) {
    const unit = unitForTopic(course, topicId);
    if (unit) unitAsked.set(unit.id, (unitAsked.get(unit.id) ?? 0) + 1);
  }

  const candidates = allTopics(course).filter((topic) => !asked.has(topic.id));
  candidates.sort((a, b) => {
    const aScore = diagnosticScore(course, a, unitAsked);
    const bScore = diagnosticScore(course, b, unitAsked);
    if (aScore !== bScore) return bScore - aScore;
    return course.topicOrder.indexOf(a.id) - course.topicOrder.indexOf(b.id);
  });
  return candidates[0] ?? null;
}

function diagnosticScore(course, topic, unitAsked) {
  const unit = unitForTopic(course, topic.id);
  const ancestors = ancestorIds(course, topic.id).length;
  const descendants = descendantIds(course, topic.id).length;
  const information = Math.min(ancestors + 1, descendants + 1) * 4;
  const coverage = Math.min(ancestors + descendants, 12);
  const rotationPenalty = (unitAsked.get(unit?.id) ?? 0) * 8;
  return information + coverage - rotationPenalty;
}

export function applyDiagnosticAnswer(
  course,
  progress,
  topicId,
  correct,
  now = Date.now()
) {
  const next = clone(progress);
  if (!topicById(course, topicId)) return next;
  if (!next.diagnostic.asked.includes(topicId)) {
    next.diagnostic.asked.push(topicId);
  }
  next.diagnostic.status = 'in-progress';
  next.diagnostic.results[topicId] = Boolean(correct);
  const timestamp = new Date(now).toISOString();
  const state = next.topics[topicId];
  state.lastAnsweredAt = timestamp;

  if (correct) {
    state.stability = Math.max(1, state.stability);
    state.provisional = false;
    state.needsRemediation = false;
    state.masteredAt ??= timestamp;
    state.nextReviewAt = addDays(now, 1);
    for (const ancestorId of ancestorIds(course, topicId)) {
      const ancestor = next.topics[ancestorId];
      if (ancestor.stability === 0) {
        ancestor.stability = 1;
        ancestor.provisional = true;
        ancestor.masteredAt = timestamp;
        ancestor.nextReviewAt = addDays(now, 1);
      }
    }
  } else {
    state.correctStreak = 0;
    state.stability = Math.max(0, state.stability - 1);
    state.provisional = false;
    state.needsRemediation = true;
    state.nextReviewAt = timestamp;
    for (const descendantId of descendantIds(course, topicId)) {
      const descendant = next.topics[descendantId];
      if (descendant.provisional) {
        descendant.stability = 0;
        descendant.provisional = false;
        descendant.nextReviewAt = null;
      }
    }
  }
  next.updatedAt = timestamp;
  return next;
}

export function finishDiagnostic(progress, now = Date.now()) {
  const next = clone(progress);
  next.diagnostic.status = 'complete';
  next.diagnostic.completedAt = new Date(now).toISOString();
  next.updatedAt = next.diagnostic.completedAt;
  return next;
}

export function applyPracticeAnswer(
  _course,
  progress,
  topicId,
  correct,
  now = Date.now()
) {
  const next = clone(progress);
  const state = next.topics[topicId];
  if (!state) return { progress: next, mastered: false, xpAwarded: 0 };
  const timestamp = new Date(now).toISOString();
  const wasLearned = state.stability > 0;
  state.attempts += 1;
  state.lastAnsweredAt = timestamp;
  let xpAwarded = 0;
  let mastered = false;
  if (correct) {
    state.correctStreak += 1;
    if (!wasLearned) xpAwarded += 1;
    if (state.correctStreak >= 2 && state.stability === 0) {
      state.stability = 1;
      state.provisional = false;
      state.needsRemediation = false;
      state.masteredAt = timestamp;
      state.nextReviewAt = addDays(now, REVIEW_INTERVAL_DAYS[1]);
      xpAwarded += 3;
      mastered = true;
    }
  } else {
    state.correctStreak = 0;
    state.needsRemediation = true;
  }
  awardXp(next, xpAwarded, now);
  next.updatedAt = timestamp;
  return { progress: next, mastered, xpAwarded };
}

export function reviewExerciseSet(course, progress, topicId, count = 3) {
  const topic = topicById(course, topicId);
  if (!topic) return [];
  const candidates = [
    topicId,
    ...ancestorIds(course, topicId)
      .filter((candidate) => progress.topics[candidate]?.stability > 0)
      .reverse(),
    ...course.topicOrder.filter(
      (candidate) =>
        unitForTopic(course, candidate)?.id ===
          unitForTopic(course, topicId)?.id &&
        progress.topics[candidate]?.stability > 0
    ),
    ...course.topicOrder.filter(
      (candidate) => progress.topics[candidate]?.stability > 0
    ),
  ];
  const selected = [];
  for (const candidate of [...new Set(candidates)]) {
    const exercise = pickExercise(
      topicById(course, candidate),
      'review',
      `${currentDaySalt()}:${selected.length}`
    );
    if (exercise) selected.push({ ...exercise, topicId: candidate });
    if (selected.length === count) break;
  }
  return selected;
}

export function applyReviewResult(
  course,
  progress,
  topicId,
  correctCount,
  total = 3,
  now = Date.now()
) {
  const next = clone(progress);
  const state = next.topics[topicId];
  if (!state) return next;
  const passed = reviewPassed(correctCount, total);
  const interval = REVIEW_INTERVAL_DAYS[Math.max(1, state.stability)];
  const scheduledAt = state.nextReviewAt
    ? Date.parse(state.nextReviewAt)
    : Number.NaN;
  const overdueHold =
    passed &&
    Number.isFinite(scheduledAt) &&
    now - scheduledAt > interval * 2 * 86_400_000;
  if (passed) {
    state.stability = overdueHold
      ? Math.max(1, state.stability)
      : Math.min(MAX_STABILITY, Math.max(1, state.stability) + 1);
    state.provisional = false;
    state.needsRemediation = false;
    state.correctStreak = 0;
    state.nextReviewAt = addDays(
      now,
      overdueHold ? interval : REVIEW_INTERVAL_DAYS[state.stability]
    );
  } else {
    state.stability = Math.max(0, state.stability - 1);
    state.correctStreak = 0;
    state.needsRemediation = true;
    state.nextReviewAt = new Date(now).toISOString();
  }
  propagateImplicitCredit(course, next, topicId, passed, now);
  state.lastAnsweredAt = new Date(now).toISOString();
  awardXp(next, correctCount + (passed ? 2 : 0), now);
  next.updatedAt = new Date(now).toISOString();
  return next;
}

export function reviewPassed(correctCount, total) {
  return correctCount >= Math.ceil(total * (2 / 3));
}

export function propagateImplicitCredit(
  course,
  next,
  topicId,
  passed,
  now = Date.now()
) {
  const topic = topicById(course, topicId);
  if (!topic) return next;
  for (const prerequisiteId of topic.prerequisites) {
    const prerequisite = next.topics[prerequisiteId];
    if (!prerequisite || prerequisite.stability === 0) continue;
    const current = prerequisite.nextReviewAt
      ? Date.parse(prerequisite.nextReviewAt)
      : Number.NaN;
    const target = passed
      ? now + (REVIEW_INTERVAL_DAYS[prerequisite.stability] * 86_400_000) / 2
      : now + 86_400_000;
    const scheduled = Number.isFinite(current)
      ? passed
        ? Math.max(current, target)
        : Math.min(current, target)
      : target;
    prerequisite.nextReviewAt = new Date(scheduled).toISOString();
  }
  return next;
}

export function checkpointExerciseSet(
  course,
  unitId,
  count = 5,
  salt = currentDaySalt()
) {
  const unit = course.units.find((candidate) => candidate.id === unitId);
  if (!unit) return [];
  const topics = unit.topics;
  if (topics.length <= count) {
    return topics
      .map((topic) => ({
        ...pickExercise(topic, 'review', salt),
        topicId: topic.id,
      }))
      .filter((exercise) => exercise.id);
  }
  const indexes = Array.from({ length: count }, (_, index) =>
    Math.round((index * (topics.length - 1)) / (count - 1))
  );
  return [...new Set(indexes)]
    .map((index) => topics[index])
    .map((topic) => ({
      ...pickExercise(topic, 'review', salt),
      topicId: topic.id,
    }));
}

export function checkpointReady(course, progress, unitId) {
  const unit = course.units.find((candidate) => candidate.id === unitId);
  return Boolean(
    unit?.topics.every((topic) => progress.topics[topic.id]?.stability > 0)
  );
}

export function applyCheckpointResult(
  course,
  progress,
  unitId,
  answers,
  now = Date.now()
) {
  const next = clone(progress);
  const correctCount = answers.filter((answer) => answer.correct).length;
  const passed = correctCount >= Math.ceil(answers.length * 0.8);
  const previous = next.checkpoints[unitId];
  const wasPassed = Boolean(previous?.passed);
  next.checkpoints[unitId] = {
    passed: Boolean(previous?.passed) || passed,
    bestScore: Math.max(previous?.bestScore ?? 0, correctCount),
    completedAt: passed
      ? (previous?.completedAt ?? new Date(now).toISOString())
      : (previous?.completedAt ?? null),
  };
  for (const answer of answers) {
    if (!next.topics[answer.topicId]) continue;
    propagateImplicitCredit(
      course,
      next,
      answer.topicId,
      Boolean(answer.correct),
      now
    );
    if (!answer.correct) {
      next.topics[answer.topicId].needsRemediation = true;
      next.topics[answer.topicId].nextReviewAt = new Date(now).toISOString();
    }
  }
  awardXp(next, wasPassed ? 0 : correctCount + (passed ? 5 : 0), now);
  next.updatedAt = new Date(now).toISOString();
  return { progress: next, passed, correctCount };
}

export function capstoneReady(course, progress) {
  return course.finalCapstone.prerequisites.every(
    (topicId) => progress.topics[topicId]?.stability > 0
  );
}

export function applyCapstoneResult(progress, correctCount, now = Date.now()) {
  const next = clone(progress);
  const passed = correctCount >= 3;
  const wasComplete = next.capstone.completed;
  next.capstone.bestScore = Math.max(next.capstone.bestScore, correctCount);
  if (passed) {
    next.capstone.completed = true;
    next.capstone.completedAt ??= new Date(now).toISOString();
  }
  awardXp(next, wasComplete ? 0 : correctCount + (passed ? 5 : 0), now);
  next.updatedAt = new Date(now).toISOString();
  return { progress: next, passed };
}

export function recommendedTasks(
  course,
  progress,
  now = Date.now(),
  limit = 5
) {
  const tasks = [];
  const added = new Set();
  const addTopic = (topic, type, eyebrow, detail) => {
    if (!topic || added.has(topic.id) || tasks.length >= limit) return;
    added.add(topic.id);
    tasks.push({
      type,
      id: topic.id,
      title: topic.title,
      eyebrow,
      detail,
      href: `${academyRoot(course)}/topics/${topic.id}/`,
    });
  };

  if (progress.diagnostic.status !== 'complete') {
    tasks.push({
      type: 'diagnostic',
      id: 'diagnostic',
      title: progress.diagnostic.asked.length
        ? 'Continue your diagnostic'
        : 'Find your starting point',
      eyebrow: 'Starting quiz',
      detail: `${progress.diagnostic.asked.length} of 12–15 questions answered`,
      href: `${academyRoot(course)}/diagnostic/`,
    });
  }

  const due = allTopics(course)
    .filter(
      (topic) => topicStatus(course, progress, topic.id, now) === 'review'
    )
    .sort(
      (a, b) =>
        Date.parse(progress.topics[a.id].nextReviewAt) -
        Date.parse(progress.topics[b.id].nextReviewAt)
    );
  if (due.length > 0 && tasks.length < limit) {
    tasks.push({
      type: 'review',
      id: 'daily-review',
      title: 'Daily review',
      eyebrow: 'Spaced review',
      detail: `${due.length} topic${due.length === 1 ? '' : 's'} due`,
      href: `${academyRoot(course)}/review/`,
    });
  }

  const remediation = allTopics(course).filter((topic) => {
    const state = progress.topics[topic.id];
    return (
      state.needsRemediation &&
      topic.prerequisites.every(
        (prerequisite) => progress.topics[prerequisite]?.stability > 0
      )
    );
  });
  for (const topic of remediation) {
    addTopic(
      topic,
      'remediation',
      'Practice again',
      'Revisit the example and get it right twice'
    );
  }

  const ready = allTopics(course)
    .filter((topic) => topicStatus(course, progress, topic.id, now) === 'ready')
    .sort(
      (a, b) =>
        descendantIds(course, b.id).length - descendantIds(course, a.id).length
    );
  const usedUnits = new Set(
    tasks.map((task) => unitForTopic(course, task.id)?.id).filter(Boolean)
  );
  for (const topic of ready) {
    if (tasks.length >= limit) break;
    const unitId = unitForTopic(course, topic.id)?.id;
    if (
      usedUnits.has(unitId) &&
      ready.some(
        (candidate) => !usedUnits.has(unitForTopic(course, candidate.id)?.id)
      )
    ) {
      continue;
    }
    addTopic(
      topic,
      'lesson',
      `Unit ${unitForTopic(course, topic.id)?.number}`,
      `${topic.minutes} min · unlocks ${descendantIds(course, topic.id).length} later topics`
    );
    usedUnits.add(unitId);
  }

  for (const unit of course.units) {
    if (tasks.length >= limit) break;
    if (
      checkpointReady(course, progress, unit.id) &&
      !progress.checkpoints[unit.id]?.passed
    ) {
      tasks.push({
        type: 'checkpoint',
        id: unit.id,
        title: `Check your understanding of ${unit.title}`,
        eyebrow: 'Unit review',
        detail: '5 questions · answer 4 correctly',
        href: `${academyRoot(course)}/checkpoints/${unit.id}/`,
      });
    }
  }

  if (
    tasks.length < limit &&
    capstoneReady(course, progress) &&
    !progress.capstone.completed
  ) {
    tasks.push({
      type: 'capstone',
      id: course.finalCapstone.id,
      title: course.finalCapstone.title,
      eyebrow: 'Final build',
      detail: 'Connect the complete Ax system',
      href: `${academyRoot(course)}/capstone/`,
    });
  }

  return tasks.slice(0, limit);
}

export function setDailyGoal(progress, goal, now = Date.now()) {
  const next = clone(progress);
  next.dailyGoal = normalizeGoal(goal, 20);
  next.updatedAt = new Date(now).toISOString();
  return next;
}

export function dayStreak(progress, now = Date.now()) {
  const cursor = new Date(now);
  if ((progress.xpByDay[dayKey(cursor.getTime())] ?? 0) === 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while ((progress.xpByDay[dayKey(cursor.getTime())] ?? 0) > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function reviewForecast(course, progress, now = Date.now(), days = 7) {
  const buckets = Array.from({ length: days }, (_, offset) => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    return { date: dayKey(date.getTime()), count: 0 };
  });
  const lastDay = new Date(now);
  lastDay.setHours(23, 59, 59, 999);
  lastDay.setDate(lastDay.getDate() + Math.max(0, days - 1));
  for (const topic of allTopics(course)) {
    const state = progress.topics[topic.id];
    if (state?.stability === 0 || !state?.nextReviewAt) continue;
    const reviewAt = Date.parse(state.nextReviewAt);
    if (!Number.isFinite(reviewAt) || reviewAt > lastDay.getTime()) continue;
    const key = reviewAt <= now ? buckets[0]?.date : dayKey(reviewAt);
    const bucket = buckets.find((candidate) => candidate.date === key);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export function dailyReviewSet(course, progress, now = Date.now(), max = 10) {
  const remaining = allTopics(course)
    .filter(
      (topic) => topicStatus(course, progress, topic.id, now) === 'review'
    )
    .sort(
      (a, b) =>
        Date.parse(progress.topics[a.id].nextReviewAt) -
        Date.parse(progress.topics[b.id].nextReviewAt)
    );
  const selected = [];
  let lastUnitId = null;
  while (remaining.length > 0 && selected.length < max) {
    let index = remaining.findIndex(
      (topic) => unitForTopic(course, topic.id)?.id !== lastUnitId
    );
    if (index < 0) index = 0;
    const [topic] = remaining.splice(index, 1);
    const exercise = pickExercise(
      topic,
      'review',
      Math.floor(now / 86_400_000)
    );
    if (!exercise) continue;
    selected.push({ ...exercise, topicId: topic.id });
    lastUnitId = unitForTopic(course, topic.id)?.id ?? null;
  }
  return selected;
}

export function exerciseForRole(topic, role) {
  return exercisesForRole(topic, role)[0];
}

export function exercisesForRole(topic, role) {
  return (
    topic?.exercises?.filter((exercise) => exercise.roles?.includes(role)) ?? []
  );
}

export function pickExercise(topic, role, salt = currentDaySalt()) {
  const exercises = exercisesForRole(topic, role);
  if (exercises.length === 0) return undefined;
  const index = hashSeed(`${topic.id}:${role}:${salt}`) % exercises.length;
  return exercises[index];
}

export function topicById(course, topicId) {
  for (const unit of course.units) {
    const topic = unit.topics.find((candidate) => candidate.id === topicId);
    if (topic) return topic;
  }
  return null;
}

export function unitForTopic(course, topicId) {
  return course.units.find((unit) =>
    unit.topics.some((topic) => topic.id === topicId)
  );
}

export function allTopics(course) {
  return course.units.flatMap((unit) => unit.topics);
}

export function ancestorIds(course, topicId) {
  const found = new Set();
  const visit = (id) => {
    for (const prerequisite of topicById(course, id)?.prerequisites ?? []) {
      if (found.has(prerequisite)) continue;
      found.add(prerequisite);
      visit(prerequisite);
    }
  };
  visit(topicId);
  return course.topicOrder.filter((id) => found.has(id));
}

export function descendantIds(course, topicId) {
  const found = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const topic of allTopics(course)) {
      if (found.has(topic.id) || topic.id === topicId) continue;
      if (
        topic.prerequisites.some(
          (prerequisite) => prerequisite === topicId || found.has(prerequisite)
        )
      ) {
        found.add(topic.id);
        changed = true;
      }
    }
  }
  return course.topicOrder.filter((id) => found.has(id));
}

function awardXp(progress, amount, now) {
  if (!amount) return;
  const key = dayKey(now);
  progress.xpByDay[key] = (progress.xpByDay[key] ?? 0) + amount;
  progress.totalXP += amount;
}

function dayKey(now) {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(now, days) {
  return new Date(now + days * 86_400_000).toISOString();
}

function currentDaySalt() {
  return Math.floor(Date.now() / 86_400_000);
}

function academyRoot(course) {
  return `/${course.language}/academy`;
}

function normalizeGoal(value, fallback) {
  const parsed = Number(value);
  return [10, 20, 30, 40].includes(parsed) ? parsed : fallback;
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function clampNumber(value, minimum, maximum) {
  return Math.min(
    maximum,
    Math.max(minimum, Math.round(nonNegativeNumber(value)))
  );
}

function cleanXpDays(input) {
  const result = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) result[key] = nonNegativeNumber(value);
  }
  return result;
}

function validIso(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    return null;
  return new Date(value).toISOString();
}

function clone(value) {
  return structuredClone(value);
}
