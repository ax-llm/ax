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
  exerciseForRole,
  finishDiagnostic,
  MAX_DIAGNOSTIC_QUESTIONS,
  MIN_DIAGNOSTIC_QUESTIONS,
  migrateProgress,
  recommendedTasks,
  reviewExerciseSet,
  selectDiagnosticTopic,
  setDailyGoal,
  storageKey,
  topicById,
  topicStatus,
} from './academy-engine.js';

const root = document.querySelector('[data-academy-root]');
const dataElement = document.querySelector('#academy-course-data');
let recoveredState = false;

if (root && dataElement) {
  const course = JSON.parse(dataElement.textContent || '{}');
  let progress = readProgress(course);

  const save = (next) => {
    progress = migrateProgress(course, next);
    try {
      localStorage.setItem(storageKey(course), JSON.stringify(progress));
    } catch {
      // The course still works for this page view when storage is unavailable.
    }
    return progress;
  };

  const page = root.dataset.academyPage;
  if (page === 'dashboard') initDashboard(course, progress, save);
  if (page === 'diagnostic') initDiagnostic(course, progress, save);
  if (page === 'topic') initTopic(course, progress, save, root.dataset.topicId);
  if (page === 'checkpoint') {
    initCheckpoint(course, progress, save, root.dataset.unitId);
  }
  if (page === 'capstone') initCapstone(course, progress, save);
}

function readProgress(course) {
  try {
    const raw = localStorage.getItem(storageKey(course));
    if (!raw) return createProgress(course);
    return migrateProgress(course, JSON.parse(raw));
  } catch {
    recoveredState = true;
    return createProgress(course);
  }
}

function initDashboard(course, initialProgress, save) {
  let progress = initialProgress;
  const render = () => {
    const stats = courseStats(course, progress);
    const goal = progress.dailyGoal;
    const summary = root.querySelector('[data-academy-progress-summary]');
    const percent = root.querySelector('[data-academy-progress-percent]');
    const count = root.querySelector('[data-academy-progress-count]');
    const goalLabel = root.querySelector('[data-academy-daily-goal-label]');
    const today = root.querySelector('[data-academy-today-xp]');
    if (today) today.textContent = String(stats.todayXP);
    if (goalLabel) goalLabel.textContent = String(goal);
    if (percent) percent.textContent = `${stats.percent}%`;
    if (count) count.textContent = String(stats.learned);
    if (summary) {
      summary.setAttribute(
        'aria-label',
        `${stats.learned} of ${stats.total} lessons learned, ${stats.todayXP} of ${goal} daily XP`
      );
    }

    const label = root.querySelector('[data-academy-progress-label]');
    const detail = root.querySelector('[data-academy-progress-detail]');
    if (label) {
      label.textContent = stats.learned
        ? `${stats.learned} lesson${stats.learned === 1 ? '' : 's'} learned`
        : 'Ready to begin';
    }
    if (detail) {
      detail.textContent = `${stats.due} review${stats.due === 1 ? '' : 's'} due · ${progress.totalXP} total XP`;
    }

    const tasks = recommendedTasks(course, progress);
    const nextTask = tasks.find((task) => task.type !== 'diagnostic');
    const continueLink = root.querySelector('[data-academy-continue]');
    if (continueLink) {
      if (nextTask) {
        continueLink.href = nextTask.href;
        continueLink.textContent = continueActionLabel(nextTask, stats.learned);
        continueLink.setAttribute(
          'aria-label',
          `${continueLink.textContent}: ${nextTask.title}`
        );
      } else {
        continueLink.href = '#academy-map-title';
        continueLink.textContent = 'Review the course';
        continueLink.setAttribute(
          'aria-label',
          'Review the course learning path'
        );
      }
    }
    const startingQuiz = root.querySelector('[data-academy-starting-quiz]');
    if (startingQuiz) {
      startingQuiz.textContent =
        progress.diagnostic.status === 'in-progress'
          ? 'Continue starting quiz'
          : progress.diagnostic.status === 'complete'
            ? 'Retake starting quiz'
            : 'Already experienced? Find your starting point';
    }

    for (const card of root.querySelectorAll('[data-academy-topic-card]')) {
      const topicId = card.dataset.academyTopicCard;
      const status = topicStatus(course, progress, topicId);
      card.dataset.status = status;
      const marker = card.querySelector('[data-academy-topic-status]');
      if (marker) marker.textContent = statusMarker(status);
      card.setAttribute(
        'aria-label',
        `${card.textContent.trim()} · ${statusLabel(status)}`
      );
    }

    for (const unit of course.units) {
      const unitElement = root.querySelector(
        `[data-academy-unit="${unit.id}"]`
      );
      if (!unitElement) continue;
      const learned = unit.topics.filter(
        (topic) => progress.topics[topic.id].stability > 0
      ).length;
      const complete = learned === unit.topics.length;
      const remaining = unit.topics.length - learned;
      unitElement.dataset.complete = String(complete);
      const progressLabel = unitElement.querySelector(
        '[data-academy-unit-progress]'
      );
      if (progressLabel) {
        progressLabel.textContent = `${learned} of ${unit.topics.length} lessons`;
      }
      const reviewStatus = unitElement.querySelector(
        '[data-academy-unit-review-status]'
      );
      if (reviewStatus) {
        reviewStatus.textContent = complete
          ? 'Ready now · 5 questions'
          : `Available after ${remaining} more lesson${remaining === 1 ? '' : 's'} · 5 questions`;
      }
      const reviewLink = unitElement.querySelector(
        '[data-academy-unit-review-link]'
      );
      if (reviewLink) {
        reviewLink.textContent = complete
          ? 'Start knowledge check →'
          : 'Finish lessons to unlock';
        reviewLink.setAttribute('aria-disabled', String(!complete));
        if (complete) reviewLink.removeAttribute('tabindex');
        else reviewLink.setAttribute('tabindex', '-1');
      }
    }
  };

  const goalSelect = root.querySelector('[data-academy-daily-goal]');
  if (goalSelect) {
    goalSelect.value = String(progress.dailyGoal);
    goalSelect.addEventListener('change', () => {
      progress = save(setDailyGoal(progress, goalSelect.value));
      setSettingsStatus(`Daily goal set to ${progress.dailyGoal} XP.`);
      render();
    });
  }

  root.querySelector('[data-academy-export]')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(progress, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ax-academy-${course.id}-progress.json`;
    link.click();
    URL.revokeObjectURL(url);
    setSettingsStatus('Progress exported.');
  });

  root
    .querySelector('[data-academy-import]')
    ?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const imported = JSON.parse(await file.text());
        progress = save(migrateProgress(course, imported));
        setSettingsStatus('Progress imported.');
        render();
      } catch {
        setSettingsStatus('That file is not valid Ax Academy progress.', true);
      }
      event.target.value = '';
    });

  root.querySelector('[data-academy-reset]')?.addEventListener('click', () => {
    if (!window.confirm('Reset all Ax Academy progress on this device?'))
      return;
    progress = save(createProgress(course));
    if (goalSelect) goalSelect.value = String(progress.dailyGoal);
    setSettingsStatus('Progress reset.');
    render();
  });

  if (recoveredState) {
    setSettingsStatus(
      'Unreadable saved progress was replaced with a clean state.',
      true
    );
  }
  render();
}

function setSettingsStatus(message, error = false) {
  const status = root.querySelector('[data-academy-settings-status]');
  if (!status) return;
  status.textContent = message;
  status.dataset.error = String(error);
}

function continueActionLabel(task, learnedCount) {
  return {
    review: 'Review now',
    remediation: 'Practice again',
    lesson:
      learnedCount === 0 ? 'Build your first AI program' : 'Continue building',
    checkpoint: 'Start knowledge check',
    capstone: 'Start final project',
  }[task.type];
}

function initDiagnostic(course, initialProgress, save) {
  let progress = initialProgress;
  const intro = root.querySelector('[data-academy-diagnostic-intro]');
  const quiz = root.querySelector('[data-academy-diagnostic-quiz]');
  const result = root.querySelector('[data-academy-diagnostic-result]');
  const start = root.querySelector('[data-academy-diagnostic-start]');

  if (progress.diagnostic.status === 'in-progress') {
    intro.hidden = true;
    quiz.hidden = false;
    showNext();
  } else if (progress.diagnostic.status === 'complete') {
    start.textContent = 'Retake starting quiz';
    showDiagnosticSummary(course, progress, result);
  }

  start?.addEventListener('click', () => {
    progress = structuredClone(progress);
    progress.diagnostic = {
      status: 'in-progress',
      asked: [],
      results: {},
      completedAt: null,
    };
    progress = save(progress);
    intro.hidden = true;
    result.hidden = true;
    quiz.hidden = false;
    showNext();
  });

  function showNext() {
    const topic = selectDiagnosticTopic(course, progress);
    if (!topic) return complete();
    const exercise = exerciseForRole(topic, 'diagnostic');
    renderExercise(quiz, exercise, {
      index: progress.diagnostic.asked.length + 1,
      total: MAX_DIAGNOSTIC_QUESTIONS,
      context: `Testing: ${topic.title}`,
      onAnswered(correct) {
        progress = save(
          applyDiagnosticAnswer(course, progress, topic.id, correct)
        );
      },
      onNext() {
        if (progress.diagnostic.asked.length >= MAX_DIAGNOSTIC_QUESTIONS) {
          complete();
          return;
        }
        if (progress.diagnostic.asked.length >= MIN_DIAGNOSTIC_QUESTIONS) {
          showDiagnosticDecision();
          return;
        }
        showNext();
      },
    });
  }

  function showDiagnosticDecision() {
    quiz.replaceChildren();
    const box = document.createElement('div');
    box.className = 'academy-decision';
    const title = document.createElement('h2');
    title.textContent = `${progress.diagnostic.asked.length} questions complete`;
    const copy = document.createElement('p');
    copy.textContent =
      'You can finish now, or answer up to three more questions for a more precise starting point.';
    const actions = document.createElement('div');
    actions.className = 'academy-actions';
    const finish = button('See my starting point', true);
    finish.addEventListener('click', complete);
    const continueButton = button('Answer more questions');
    continueButton.addEventListener('click', showNext);
    actions.append(finish, continueButton);
    box.append(title, copy, actions);
    quiz.append(box);
  }

  function complete() {
    progress = save(finishDiagnostic(progress));
    quiz.hidden = true;
    showDiagnosticSummary(course, progress, result);
  }
}

function showDiagnosticSummary(course, progress, host) {
  if (!host) return;
  const stats = courseStats(course, progress);
  const directCorrect = Object.values(progress.diagnostic.results).filter(
    Boolean
  ).length;
  const provisional = Object.values(progress.topics).filter(
    (state) => state.provisional
  ).length;
  host.hidden = false;
  host.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'Your starting point is ready';
  const copy = document.createElement('p');
  copy.textContent = `You answered ${directCorrect} questions correctly. We marked ${provisional} earlier lesson${provisional === 1 ? '' : 's'} as likely known, with ${stats.total - stats.learned} lessons left to learn.`;
  const note = document.createElement('p');
  note.textContent =
    'We will check the lessons marked as likely known again soon. Your recommendations will adjust as you practice.';
  const link = document.createElement('a');
  link.className = 'academy-button academy-button-primary';
  link.href = `${academyRoot(course)}/`;
  link.textContent = 'Show my next lesson';
  host.append(heading, copy, note, link);
}

function initTopic(course, initialProgress, save, topicId) {
  let progress = initialProgress;
  const topic = topicById(course, topicId);
  const host = root.querySelector('[data-academy-topic-practice]');
  const stateLabel = root.querySelector('[data-academy-topic-state]');
  const countLabel = root.querySelector('[data-academy-practice-count]');
  if (!topic || !host) return;
  const status = topicStatus(course, progress, topicId);
  if (stateLabel) stateLabel.textContent = statusLabel(status);

  if (status === 'locked') {
    const missing = topic.prerequisites.filter(
      (prerequisite) => progress.topics[prerequisite]?.stability === 0
    );
    renderLocked(host, course, missing);
    return;
  }

  if (status === 'review' || status === 'provisional') {
    const exercises = reviewExerciseSet(course, progress, topicId);
    runExerciseSequence(host, exercises, {
      context: 'Spaced review',
      onComplete(records) {
        const correctCount = records.filter((record) => record.correct).length;
        progress = save(
          applyReviewResult(progress, topicId, correctCount, records.length)
        );
        const passed = correctCount >= 2;
        showCompletion(
          course,
          host,
          passed ? 'Review strengthened' : 'Review scheduled for repair',
          passed
            ? `You answered ${correctCount} of ${records.length} correctly. The next interval is longer.`
            : `You answered ${correctCount} of ${records.length} correctly. This topic is back in your focused queue.`
        );
        if (stateLabel) {
          stateLabel.textContent = statusLabel(
            topicStatus(course, progress, topicId)
          );
        }
      },
    });
    return;
  }

  let attempts = 0;
  const exercise = exerciseForRole(topic, 'practice');
  const showPractice = () => {
    if (countLabel) countLabel.textContent = `${attempts} / 5 attempts`;
    renderExercise(host, exercise, {
      index: attempts + 1,
      total: 5,
      context: attempts === 0 ? 'Practice' : 'Build a two-answer streak',
      onAnswered(correct) {
        attempts += 1;
        const result = applyPracticeAnswer(course, progress, topicId, correct);
        progress = save(result.progress);
        if (countLabel) countLabel.textContent = `${attempts} / 5 attempts`;
      },
      onNext() {
        const learned = progress.topics[topicId].stability > 0;
        if (learned) {
          showCompletion(
            course,
            host,
            'Knowledge point learned',
            'You built a two-answer streak. The first spaced review is scheduled for tomorrow.'
          );
          if (stateLabel) stateLabel.textContent = 'Learned · review in 1 day';
          return;
        }
        if (attempts >= 5) {
          showCompletion(
            course,
            host,
            'Keep this in your learning queue',
            'Revisit the worked example, then return from the dashboard for another focused attempt.'
          );
          return;
        }
        showPractice();
      },
    });
  };
  showPractice();
}

function initCheckpoint(course, initialProgress, save, unitId) {
  let progress = initialProgress;
  const host = root.querySelector('[data-academy-checkpoint-quiz]');
  const result = root.querySelector('[data-academy-checkpoint-result]');
  if (!host) return;
  if (!checkpointReady(course, progress, unitId)) {
    const unit = course.units.find((candidate) => candidate.id === unitId);
    const missing = unit.topics
      .filter((topic) => progress.topics[topic.id].stability === 0)
      .map((topic) => topic.id);
    renderLocked(
      host,
      course,
      missing,
      'Finish the lessons in this unit before starting the knowledge check.'
    );
    return;
  }
  const exercises = checkpointExerciseSet(course, unitId);
  runExerciseSequence(host, exercises, {
    context: 'Unit knowledge check',
    onComplete(records) {
      const outcome = applyCheckpointResult(progress, unitId, records);
      progress = save(outcome.progress);
      host.hidden = true;
      result.hidden = false;
      result.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = outcome.passed
        ? 'Knowledge check passed'
        : 'Review and retry';
      const copy = document.createElement('p');
      copy.textContent = `${outcome.correctCount} of ${records.length} correct. ${outcome.passed ? 'You are ready to move on.' : 'Missed lessons have returned to your learning queue.'}`;
      const link = document.createElement('a');
      link.className = 'academy-button academy-button-primary';
      link.href = `${academyRoot(course)}/`;
      link.textContent = 'Return to my queue';
      result.append(heading, copy, link);
    },
  });
}

function initCapstone(course, initialProgress, save) {
  let progress = initialProgress;
  const host = root.querySelector('[data-academy-capstone-quiz]');
  const result = root.querySelector('[data-academy-capstone-result]');
  if (!host) return;
  if (!capstoneReady(course, progress)) {
    const missing = course.finalCapstone.prerequisites.filter(
      (topicId) => progress.topics[topicId]?.stability === 0
    );
    renderLocked(
      host,
      course,
      missing,
      'Finish the required lessons before starting the final project.'
    );
    return;
  }
  runExerciseSequence(host, course.finalCapstone.exercises, {
    context: 'Final architecture check',
    onComplete(records) {
      const correctCount = records.filter((record) => record.correct).length;
      const outcome = applyCapstoneResult(progress, correctCount);
      progress = save(outcome.progress);
      host.hidden = true;
      result.hidden = false;
      result.replaceChildren();
      const heading = document.createElement('h2');
      heading.textContent = outcome.passed
        ? 'Course complete'
        : 'Review how the pieces connect';
      const copy = document.createElement('p');
      copy.textContent = outcome.passed
        ? 'You connected reliable AI programs, workflows, agents, external tools, long-running tasks, and live events into one production system.'
        : `${correctCount} of 3 correct. Review the relevant lessons and try again.`;
      const link = document.createElement('a');
      link.className = 'academy-button academy-button-primary';
      link.href = `${academyRoot(course)}/`;
      link.textContent = 'Return to the Academy';
      result.append(heading, copy, link);
    },
  });
}

function runExerciseSequence(host, exercises, { context, onComplete }) {
  const records = [];
  let index = 0;
  const show = () => {
    const exercise = exercises[index];
    if (!exercise) {
      onComplete(records);
      return;
    }
    renderExercise(host, exercise, {
      index: index + 1,
      total: exercises.length,
      context,
      onAnswered(correct) {
        records.push({ topicId: exercise.topicId, correct });
      },
      onNext() {
        index += 1;
        show();
      },
    });
  };
  show();
}

function renderExercise(
  host,
  exercise,
  { index, total, context, onAnswered, onNext }
) {
  host.hidden = false;
  host.replaceChildren();
  const form = document.createElement('form');
  form.className = 'academy-question';

  const meta = document.createElement('div');
  meta.className = 'academy-question-meta';
  const label = document.createElement('span');
  label.textContent = context;
  const count = document.createElement('span');
  count.textContent = `${index} / ${total}`;
  meta.append(label, count);

  const prompt = document.createElement('h2');
  prompt.textContent = exercise.prompt;
  form.append(meta, prompt);

  let answerControl;
  if (exercise.type === 'choice') {
    const choices = document.createElement('div');
    choices.className = 'academy-choices';
    for (const [choiceIndex, choice] of exercise.choices.entries()) {
      const option = document.createElement('label');
      option.className = 'academy-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = exercise.id;
      input.value = String(choiceIndex);
      const text = document.createElement('span');
      text.textContent = choice;
      option.append(input, text);
      choices.append(option);
    }
    answerControl = choices;
  } else {
    const labelElement = document.createElement('label');
    labelElement.className = 'academy-code-answer';
    const labelText = document.createElement('span');
    labelText.textContent = 'Your answer';
    const input = document.createElement('input');
    input.type = 'text';
    input.name = exercise.id;
    input.autocomplete = 'off';
    input.spellcheck = false;
    labelElement.append(labelText, input);
    answerControl = labelElement;
  }
  form.append(answerControl);

  const feedback = document.createElement('div');
  feedback.className = 'academy-feedback';
  feedback.hidden = true;
  feedback.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'academy-question-actions';
  const submit = button('Check answer', true);
  submit.type = 'submit';
  actions.append(submit);
  form.append(feedback, actions);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const submitted = formData.get(exercise.id);
    if (submitted === null || String(submitted).trim() === '') {
      feedback.hidden = false;
      feedback.dataset.correct = 'false';
      feedback.textContent = 'Choose or enter an answer first.';
      return;
    }
    const correct = evaluateExercise(exercise, submitted);
    onAnswered(correct);
    for (const input of form.querySelectorAll('input')) input.disabled = true;
    feedback.hidden = false;
    feedback.dataset.correct = String(correct);
    const result = document.createElement('strong');
    result.textContent = correct ? 'Correct.' : 'Not yet.';
    const explanation = document.createElement('span');
    explanation.textContent = exercise.explanation;
    feedback.replaceChildren(result, explanation);
    actions.replaceChildren();
    const next = button(index === total ? 'See result' : 'Next question', true);
    next.addEventListener('click', onNext);
    actions.append(next);
  });

  host.append(form);
  form.querySelector('input')?.focus();
}

function renderLocked(
  host,
  course,
  topicIds,
  message = 'Complete the prerequisites first.'
) {
  host.replaceChildren();
  const box = document.createElement('div');
  box.className = 'academy-locked';
  const heading = document.createElement('h2');
  heading.textContent = 'This task is still locked';
  const copy = document.createElement('p');
  copy.textContent = message;
  const list = document.createElement('ul');
  for (const topicId of topicIds) {
    const topic = topicById(course, topicId);
    if (!topic) continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = `${academyRoot(course)}/topics/${topic.id}/`;
    link.textContent = topic.title;
    item.append(link);
    list.append(item);
  }
  const dashboard = document.createElement('a');
  dashboard.className = 'academy-button';
  dashboard.href = `${academyRoot(course)}/`;
  dashboard.textContent = 'Return to my queue';
  box.append(heading, copy, list, dashboard);
  host.append(box);
}

function showCompletion(course, host, title, copy) {
  host.replaceChildren();
  const box = document.createElement('div');
  box.className = 'academy-result';
  const heading = document.createElement('h2');
  heading.textContent = title;
  const paragraph = document.createElement('p');
  paragraph.textContent = copy;
  const link = document.createElement('a');
  link.className = 'academy-button academy-button-primary';
  link.href = `${academyRoot(course)}/`;
  link.textContent = 'Continue from my queue';
  box.append(heading, paragraph, link);
  host.append(box);
}

function academyRoot(course) {
  return `/${course.language}/academy`;
}

function button(label, primary = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `academy-button${primary ? ' academy-button-primary' : ''}`;
  element.textContent = label;
  return element;
}

function statusMarker(status) {
  return {
    locked: '○',
    ready: '→',
    learning: '••',
    provisional: '◇',
    mastered: '✓',
    review: '↻',
  }[status];
}

function statusLabel(status) {
  return {
    locked: 'Locked',
    ready: 'Ready to learn',
    learning: 'Learning',
    provisional: 'Marked as likely known · review due',
    mastered: 'Learned',
    review: 'Spaced review due',
  }[status];
}
