import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const academyRoot = (languageId) => `/${languageId}/academy`;

const unitSnippetPaths = {
  dspy: ['snippets.dspy'],
  'models-signatures': ['snippets.signature'],
  axgen: ['snippets.ax'],
  axflow: ['academy.snippets.flow'],
  axagent: ['snippets.agent'],
  rlm: ['academy.snippets.rlm'],
  'peek-context': ['academy.snippets.contextMap'],
  optimization: ['snippets.optimize'],
  mcp: ['snippetGroups.mcp.native'],
  notifications: ['snippetGroups.mcp.resourceWake'],
  production: ['snippets.telemetry'],
};

const topicSnippetPaths = {
  'ai-providers-models': ['snippets.llm'],
  'typed-tools': ['snippetGroups.tools.basic'],
  'agent-discovery': [
    'snippetGroups.tools.agentGroups',
    'snippetGroups.tools.namespaces',
  ],
  'child-agents': ['snippetGroups.tools.agentFlat', 'snippets.agent'],
  'playbook-learning': ['snippets.playbook'],
  'memory-recall': ['academy.snippets.memorySkills'],
  'skill-discovery': ['academy.snippets.memorySkills'],
  'mcp-tasks-advanced': ['snippetGroups.mcp.taskResume'],
  'event-runtime-core': ['snippetGroups.event.wake'],
  'event-actions': ['snippetGroups.event.wake'],
  'task-continuation-security': ['snippetGroups.event.resume'],
  'media-audio-thinking': ['snippets.ai.audio'],
  'ucp-and-events': ['snippetGroups.event.ucp'],
};

const codeExercisePrompts = {
  'signature-semantic-contract': (language) =>
    `Which ${language.label} API parses a reusable Ax signature?`,
  'ai-providers-models': (language) =>
    `Which ${language.label} API creates or configures an Ax model client?`,
  'fluent-fields-validation': (language) =>
    `Which ${language.label} API or type starts a typed field definition?`,
  'typed-tools': (language) =>
    `Which ${language.label} API or type creates a host tool?`,
  'optimize-gen-flow': (language) =>
    `Which ${language.label} optimizer entry point tunes an Ax program?`,
};

export async function validateAcademyCourse(
  course,
  { repoRoot, publicExports, requiredCoverage = [] }
) {
  const failures = [];
  const unitIds = new Set();
  const topics = new Map();
  const exerciseIds = new Set();

  if (!course?.id || !course?.title || !course?.courseTitle) {
    failures.push('course must define id, title, and courseTitle');
  }
  if (!Number.isInteger(course?.version) || course.version < 1) {
    failures.push('course version must be a positive integer');
  }
  if (!Array.isArray(course?.units) || course.units.length === 0) {
    failures.push('course must contain at least one unit');
  }

  for (const [unitIndex, unit] of (course.units ?? []).entries()) {
    if (!unit.id || unitIds.has(unit.id)) {
      failures.push(`unit ${unitIndex + 1} has a missing or duplicate id`);
    }
    unitIds.add(unit.id);
    if (unit.number !== unitIndex + 1) {
      failures.push(`unit ${unit.id} number must be ${unitIndex + 1}`);
    }
    if (!unit.title || !unit.description) {
      failures.push(`unit ${unit.id} needs a title and description`);
    }
    if (!Array.isArray(unit.topics) || unit.topics.length === 0) {
      failures.push(`unit ${unit.id} must contain topics`);
    }
    await validatePaths(
      unit.sourceRefs,
      `${unit.id} source`,
      repoRoot,
      failures
    );
    await validatePaths(
      unit.examplePaths,
      `${unit.id} example`,
      repoRoot,
      failures
    );

    for (const topic of unit.topics ?? []) {
      if (!topic.id || topics.has(topic.id)) {
        failures.push(`unit ${unit.id} has a missing or duplicate topic id`);
        continue;
      }
      topics.set(topic.id, { ...topic, unitId: unit.id });
      if (!topic.title || !topic.summary || !topic.example) {
        failures.push(
          `topic ${topic.id} needs title, summary, and worked example`
        );
      }
      if (!Number.isFinite(topic.minutes) || topic.minutes <= 0) {
        failures.push(`topic ${topic.id} needs a positive minute estimate`);
      }
      if (topic.examplePath) {
        await validatePath(
          topic.examplePath,
          `${topic.id} example`,
          repoRoot,
          failures
        );
      }
      validateExercises(topic, exerciseIds, failures, { publicExports });
      for (const symbol of topic.apiSymbols ?? []) {
        if (publicExports && !publicExports.has(symbol)) {
          failures.push(
            `topic ${topic.id} references missing public symbol ${symbol}`
          );
        }
      }
    }
  }

  for (const topic of topics.values()) {
    for (const prerequisite of topic.prerequisites ?? []) {
      if (!topics.has(prerequisite)) {
        failures.push(
          `topic ${topic.id} has missing prerequisite ${prerequisite}`
        );
      }
      if (prerequisite === topic.id) {
        failures.push(`topic ${topic.id} cannot require itself`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (topicId) => {
    if (visiting.has(topicId)) {
      failures.push(`course graph contains a cycle at ${topicId}`);
      return;
    }
    if (visited.has(topicId)) return;
    visiting.add(topicId);
    for (const prerequisite of topics.get(topicId)?.prerequisites ?? []) {
      if (topics.has(prerequisite)) visit(prerequisite);
    }
    visiting.delete(topicId);
    visited.add(topicId);
  };
  for (const topicId of topics.keys()) visit(topicId);

  const order = course.topicOrder ?? [];
  if (
    order.length !== topics.size ||
    new Set(order).size !== topics.size ||
    order.some((topicId) => !topics.has(topicId))
  ) {
    failures.push('topicOrder must contain every topic exactly once');
  }

  for (const coverageId of requiredCoverage) {
    const covered = course.coverage?.[coverageId];
    if (!Array.isArray(covered) || covered.length === 0) {
      failures.push(`coverage manifest is missing ${coverageId}`);
      continue;
    }
    for (const topicId of covered) {
      if (!topics.has(topicId)) {
        failures.push(
          `coverage ${coverageId} references missing topic ${topicId}`
        );
      }
    }
  }

  for (const prerequisite of course.finalCapstone?.prerequisites ?? []) {
    if (!topics.has(prerequisite)) {
      failures.push(`final capstone has missing prerequisite ${prerequisite}`);
    }
  }
  if (!course.finalCapstone?.title || !course.finalCapstone?.summary) {
    failures.push('final capstone needs a title and summary');
  }
  validateExercises(course.finalCapstone, exerciseIds, failures, {
    requiredRoles: ['capstone'],
  });

  if (failures.length > 0) {
    throw new Error(
      `Ax Academy validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
    );
  }

  return { topicCount: topics.size, unitCount: unitIds.size };
}

export async function validateAcademyLanguages(
  course,
  languages,
  { repoRoot }
) {
  const failures = [];
  const codeExercises = course.units.flatMap((unit) =>
    unit.topics.flatMap((topic) =>
      topic.exercises
        .filter((exercise) => exercise.type === 'code')
        .map((exercise) => ({ topicId: topic.id, exerciseId: exercise.id }))
    )
  );

  for (const language of languages) {
    if (!language.academy) {
      failures.push(`${language.id} is missing academy configuration`);
      continue;
    }
    for (const unit of course.units) {
      const examplePath = language.academy.unitExamples?.[unit.id];
      if (!examplePath) {
        failures.push(
          `${language.id} Academy is missing an example for ${unit.id}`
        );
      } else {
        await validatePath(
          examplePath,
          `${language.id} ${unit.id} Academy example`,
          repoRoot,
          failures
        );
      }
      if (language.id !== 'typescript' && !nativeSnippet(language, unit).code) {
        failures.push(
          `${language.id} Academy is missing a native snippet for ${unit.id}`
        );
      }
    }
    const capstoneExample = language.academy.capstoneExample;
    if (!capstoneExample) {
      failures.push(`${language.id} Academy is missing a capstone example`);
    } else {
      await validatePath(
        capstoneExample,
        `${language.id} Academy capstone example`,
        repoRoot,
        failures
      );
    }
    if (language.id !== 'typescript') {
      for (const { topicId, exerciseId } of codeExercises) {
        const answers =
          language.academy.exerciseAnswers?.[exerciseId] ??
          language.academy.exerciseAnswers?.[topicId];
        if (!Array.isArray(answers) || answers.length === 0) {
          failures.push(
            `${language.id} Academy is missing a native code answer for ${exerciseId}`
          );
        }
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Ax Academy language validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`
    );
  }
  return { languageCount: languages.length };
}

async function validatePaths(paths, label, repoRoot, failures) {
  if (!Array.isArray(paths) || paths.length === 0) {
    failures.push(`${label} list cannot be empty`);
    return;
  }
  for (const relativePath of paths) {
    await validatePath(relativePath, label, repoRoot, failures);
  }
}

async function validatePath(relativePath, label, repoRoot, failures) {
  try {
    await access(path.join(repoRoot, relativePath));
  } catch {
    failures.push(`${label} does not exist: ${relativePath}`);
  }
}

function validateExercises(
  owner,
  exerciseIds,
  failures,
  { publicExports, requiredRoles = ['diagnostic', 'practice', 'review'] } = {}
) {
  if (!Array.isArray(owner.exercises) || owner.exercises.length === 0) {
    failures.push(`${owner.id} must contain exercises`);
    return;
  }
  const roles = new Set();
  const roleCounts = new Map();
  const normalizedPrompts = new Map();
  for (const exercise of owner.exercises) {
    if (!exercise.id || exerciseIds.has(exercise.id)) {
      failures.push(`${owner.id} has a missing or duplicate exercise id`);
    }
    exerciseIds.add(exercise.id);
    for (const role of exercise.roles ?? []) {
      roles.add(role);
      roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
    }
    if (!exercise.prompt || !exercise.explanation) {
      failures.push(`exercise ${exercise.id} needs a prompt and explanation`);
    }
    const normalizedPrompt = String(exercise.prompt)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    const duplicate = normalizedPrompts.get(normalizedPrompt);
    if (duplicate) {
      failures.push(
        `${owner.id} exercises ${duplicate} and ${exercise.id} duplicate a prompt`
      );
    } else {
      normalizedPrompts.set(normalizedPrompt, exercise.id);
    }
    if (exercise.type === 'choice') {
      if (
        !Array.isArray(exercise.choices) ||
        exercise.choices.length < 2 ||
        !Number.isInteger(exercise.answer) ||
        exercise.answer !== 0
      ) {
        failures.push(
          `choice exercise ${exercise.id} must keep the authored answer at index 0`
        );
      }
    } else if (exercise.type === 'code') {
      if (typeof exercise.answer !== 'string' || !exercise.answer.trim()) {
        failures.push(`code exercise ${exercise.id} needs a text answer`);
      }
    } else {
      failures.push(
        `exercise ${exercise.id} has unsupported type ${exercise.type}`
      );
    }
    if (publicExports) {
      const declaredSymbols = new Set(owner.apiSymbols ?? []);
      for (const symbol of exercisePublicSymbols(exercise, publicExports)) {
        if (!declaredSymbols.has(symbol)) {
          failures.push(
            `${owner.id} exercise ${exercise.id} names public API ${symbol} without listing it in apiSymbols`
          );
        }
      }
    }
  }
  for (const role of requiredRoles) {
    if (!roles.has(role)) failures.push(`${owner.id} has no ${role} exercise`);
  }
  if (
    requiredRoles.includes('practice') &&
    (roleCounts.get('practice') ?? 0) < 2
  ) {
    failures.push(`${owner.id} needs at least two practice exercises`);
  }
}

function exercisePublicSymbols(exercise, publicExports) {
  const content = [exercise.prompt, ...(exercise.choices ?? [])].join('\n');
  const candidates = new Set(content.match(/\bAx[A-Z][A-Za-z0-9]*\b/g) ?? []);
  for (const match of content.matchAll(/\b([A-Za-z_$][\w$]*)\(\)/g)) {
    candidates.add(match[1]);
  }
  return [...candidates].filter((symbol) => publicExports.has(symbol));
}

export function buildAcademyPages(course, language) {
  const localizedCourse = localizeAcademyCourse(course, language);
  const manifest = academyManifest(localizedCourse);
  const pages = [
    descriptor(`${language.id}/academy/_index.md`, language, {
      title: localizedCourse.courseTitle,
      description: localizedCourse.description,
      slug: 'academy',
      page: 'dashboard',
      body: renderDashboard(localizedCourse, manifest),
    }),
    descriptor(`${language.id}/academy/diagnostic/_index.md`, language, {
      title: 'Find Your Starting Point',
      description:
        'Skip what you already know and begin with the right practical AI engineering lesson.',
      slug: 'academy/diagnostic',
      page: 'diagnostic',
      body: renderDiagnostic(localizedCourse, manifest),
    }),
    descriptor(`${language.id}/academy/review/_index.md`, language, {
      title: 'Daily Review',
      description:
        'Strengthen due Ax lessons in one interleaved review session.',
      slug: 'academy/review',
      page: 'review',
      body: renderDailyReview(localizedCourse, manifest),
    }),
  ];

  for (const unit of localizedCourse.units) {
    for (const topic of unit.topics) {
      pages.push(
        descriptor(
          `${language.id}/academy/topics/${topic.id}/_index.md`,
          language,
          {
            title: topic.title,
            description: topic.summary,
            slug: `academy/topics/${topic.id}`,
            page: 'topic',
            body: renderTopic(localizedCourse, manifest, unit, topic),
          }
        )
      );
    }
    pages.push(
      descriptor(
        `${language.id}/academy/checkpoints/${unit.id}/_index.md`,
        language,
        {
          title: `${unit.title} Knowledge Check`,
          description: `Five-question review of ${unit.title}.`,
          slug: `academy/checkpoints/${unit.id}`,
          page: 'checkpoint',
          body: renderCheckpoint(localizedCourse, manifest, unit),
        }
      )
    );
  }

  pages.push(
    descriptor(`${language.id}/academy/capstone/_index.md`, language, {
      title: localizedCourse.finalCapstone.title,
      description: localizedCourse.finalCapstone.summary,
      slug: 'academy/capstone',
      page: 'capstone',
      body: renderCapstone(localizedCourse, manifest),
    })
  );

  return pages;
}

function descriptor(
  relPath,
  language,
  { title, description, slug, page, body }
) {
  return {
    relPath,
    page: {
      title,
      description,
      weight: 150,
      generated: true,
      language: language.id,
      slug_key: slug,
      nav_group: 'academy',
      section_nav: 'academy',
      body_class: 'docs-academy',
      toc: false,
      standalone: true,
      academy: true,
      academy_page: page,
      source: 'website/content-src/academy/course.mjs',
      body,
    },
  };
}

function localizeAcademyCourse(course, language) {
  return {
    ...course,
    language: language.id,
    languageLabel: language.label,
    fence: language.fence,
    install: normalizeSnippet(language.install),
    quickStart: normalizeSnippet(language.snippets?.quickStart),
    description: `A hands-on ${language.label} course for building dependable AI features, multi-step workflows, tool-using agents, and production automation.`,
    units: course.units.map((unit) => ({
      ...unit,
      examplePaths: [language.academy.unitExamples[unit.id]],
      topics: unit.topics.map((topic) => {
        const snippet =
          language.id === 'typescript'
            ? { code: topic.example, level: 'topic' }
            : nativeSnippet(language, unit, topic.id);
        return {
          ...topic,
          example: snippet.code,
          exampleLevel: snippet.level,
          exampleSteps: (topic.exampleSteps ?? []).map((step) => ({
            ...step,
            ...(language.id === 'typescript' || step.neutral
              ? {}
              : { code: undefined }),
          })),
          exercises: topic.exercises.map((exercise) =>
            localizeExercise(exercise, topic.id, language)
          ),
        };
      }),
    })),
    finalCapstone: {
      ...course.finalCapstone,
      command: `npm run example -- ${language.id} ${language.academy.capstoneExample}`,
    },
  };
}

function localizeExercise(exercise, topicId, language) {
  const answers =
    language.academy.exerciseAnswers?.[exercise.id] ??
    language.academy.exerciseAnswers?.[topicId];
  if (exercise.type !== 'code' || !answers) return { ...exercise };
  return {
    ...exercise,
    prompt: codeExercisePrompts[topicId]?.(language) ?? exercise.prompt,
    answer: answers[0],
    alternatives: answers.slice(1),
    explanation: `${answers[0]} is the ${language.label} surface used for this capability.`,
  };
}

function nativeSnippet(language, unit, topicId) {
  const topicCandidates = topicSnippetPaths[topicId] ?? [];
  for (const candidate of topicCandidates) {
    const snippet = normalizeSnippet(readNested(language, candidate));
    if (snippet) return { code: snippet, level: 'topic' };
  }
  for (const candidate of unitSnippetPaths[unit.id] ?? []) {
    const snippet = normalizeSnippet(readNested(language, candidate));
    if (snippet) return { code: snippet, level: 'unit' };
  }
  return { code: '', level: 'unit' };
}

function readNested(value, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], value);
}

function normalizeSnippet(value) {
  if (Array.isArray(value)) return value.join('\n').trim();
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    return normalizeSnippet(value.code);
  }
  return '';
}

function academyManifest(course) {
  return {
    id: course.id,
    version: course.version,
    schemaVersion: course.schemaVersion,
    language: course.language,
    title: course.title,
    courseTitle: course.courseTitle,
    description: course.description,
    dailyGoal: course.dailyGoal,
    topicOrder: course.topicOrder,
    coverage: course.coverage,
    units: course.units.map((unit) => ({
      id: unit.id,
      number: unit.number,
      title: unit.title,
      description: unit.description,
      topics: unit.topics.map((topic) => ({
        id: topic.id,
        title: topic.title,
        prerequisites: topic.prerequisites,
        minutes: topic.minutes,
        apiLabel: topic.apiLabel,
        summary: topic.summary,
        exercises: topic.exercises,
      })),
    })),
    finalCapstone: course.finalCapstone,
  };
}

function renderDashboard(course, manifest) {
  const languageRoot = academyRoot(course.language);
  const topicCount = course.topicOrder.length;
  return academyShell(
    manifest,
    'dashboard',
    `
      <section class="academy-hero">
        <div class="academy-hero-copy">
          <span class="academy-eyebrow">Practical AI engineering · ${escapeHtml(course.languageLabel)}</span>
          <h1>${escapeHtml(course.courseTitle)}.</h1>
          <p>${escapeHtml(course.description)}</p>
          <div class="academy-actions">
            <a class="academy-button academy-button-primary" data-academy-continue href="${topicHref(course.topicOrder[0], course.language)}">Build your first AI program</a>
            <a class="academy-button" data-academy-starting-quiz href="${languageRoot}/diagnostic/"><span data-academy-starting-quiz-label>Already experienced? Find your starting point</span><span class="academy-time-chip">~3 min</span></a>
          </div>
          <p class="academy-hero-note">Progress is saved in this browser. No account or API key required.</p>
          <aside class="academy-progress-summary" data-academy-progress-summary aria-label="Course progress">
            <div class="academy-progress-overview">
              <span class="academy-course-progress-ring"><svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20.5"></circle><circle data-academy-course-ring-value cx="24" cy="24" r="20.5" pathLength="100"></circle></svg><strong data-academy-progress-percent>0%</strong></span>
              <div class="academy-progress-copy">
                <span class="academy-label">Course progress</span>
                <div class="academy-progress-count">
                  <strong data-academy-progress-count>0</strong>
                  <span>of ${topicCount} lessons</span>
                </div>
                <p class="academy-progress-label" data-academy-progress-label>Ready to begin</p>
                <small class="academy-progress-caption">~6 hours · saved in this browser</small>
              </div>
            </div>
            <div class="academy-progress-meta academy-progress-earned academy-is-hidden" data-academy-earned-stats>
              <span><strong data-academy-today-xp>0</strong> / <span data-academy-daily-goal-label>${course.dailyGoal}</span> XP today</span>
              <span><strong data-academy-total-xp>0</strong> total XP</span>
              <span data-academy-streak>0 days streak</span>
            </div>
            <span class="academy-progress-detail academy-is-hidden" data-academy-progress-detail>0 reviews due</span>
            <div class="academy-review-forecast academy-is-hidden" data-academy-forecast aria-label="Seven-day review forecast"></div>
          </aside>
        </div>
      </section>
      <section class="academy-section academy-up-next" data-academy-up-next aria-labelledby="academy-up-next-title">
        <div class="academy-section-heading academy-up-next-heading">
          <div>
            <span class="academy-label">Your next moves</span>
            <h2 id="academy-up-next-title">Up next</h2>
            <p class="academy-up-next-guidance">Start small. Your queue adapts as you learn.</p>
          </div>
        </div>
        <div class="academy-up-next-grid" data-academy-up-next-list></div>
      </section>
      <section class="academy-section" aria-labelledby="academy-map-title">
        <div class="academy-section-heading academy-path-heading">
          <div><span class="academy-label">What you will build</span><h2 id="academy-map-title">Go from one reliable AI call to production automation.</h2></div>
          <span>${course.units.length} units · ${topicCount} short lessons</span>
        </div>
        <div class="academy-path-intro">
          <p>No Ax experience needed. Each unit adds one practical capability, from structured outputs and workflows to agents, external tools, long-running tasks, and production operations.</p>
        </div>
        <div class="academy-roadmap" data-academy-roadmap>
          ${course.units.map((unit) => renderUnitRoadmap(course, unit)).join('')}
        </div>
        <div class="academy-status-key" aria-label="Lesson status key">
          <span><b aria-hidden="true">→</b> Start here</span>
          <span><b aria-hidden="true">○</b> Comes later</span>
          <span><b aria-hidden="true">✓</b> Learned</span>
          <span><b aria-hidden="true">↻</b> Review due</span>
        </div>
      </section>
      <section class="academy-section academy-settings" aria-labelledby="academy-settings-title">
        <div class="academy-section-heading"><div><span class="academy-label">Local progress</span><h2 id="academy-settings-title">Goals and portability</h2></div></div>
        <div class="academy-settings-grid">
          <label>Daily XP goal<select data-academy-daily-goal><option value="10">10 XP</option><option value="20" selected>20 XP</option><option value="30">30 XP</option><option value="40">40 XP</option></select></label>
          <button class="academy-button" type="button" data-academy-export>Export progress</button>
          <label class="academy-button academy-file-button">Import progress<input type="file" accept="application/json" data-academy-import></label>
          <button class="academy-button academy-button-danger" type="button" data-academy-reset>Reset progress</button>
        </div>
        <p class="academy-status" data-academy-settings-status aria-live="polite"></p>
      </section>
    `
  );
}

function renderUnitRoadmap(course, unit) {
  const languageRoot = academyRoot(course.language);
  return `
    <details class="academy-unit" data-academy-unit="${unit.id}"${unit.number === 1 ? ' open' : ''}>
      <summary class="academy-unit-summary">
        <span class="academy-unit-number" aria-hidden="true">${String(unit.number).padStart(2, '0')}</span>
        <span class="academy-unit-heading">
          <span><span class="academy-unit-kicker">Unit ${unit.number} · ${unitSurfaceLabels[unit.id]}</span><strong>${escapeHtml(unit.title)}</strong><small>${escapeHtml(unit.description)}</small></span>
          <span class="academy-unit-progress-wrap"><span class="academy-unit-progress-ring" data-academy-unit-ring aria-label="0 of ${unit.topics.length} lessons learned"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.5"></circle><circle data-academy-unit-ring-value cx="18" cy="18" r="15.5" pathLength="100"></circle></svg></span><span data-academy-unit-progress>0 of ${unit.topics.length}</span></span>
        </span>
      </summary>
      <div class="academy-unit-main">
        <div class="academy-topic-grid">
          ${unit.topics
            .map(
              (topic) => `
                <a class="academy-topic-card" data-academy-topic-card="${topic.id}" data-status="locked" href="${topicHref(topic.id, course.language)}">
                  <span class="academy-topic-status" data-academy-topic-status aria-hidden="true">○</span>
                  <span><strong>${escapeHtml(topic.title)}</strong><span class="academy-topic-meta"><small>${topic.minutes} min</small>${topic.apiLabel ? `<span class="academy-api-chip">${escapeHtml(topic.apiLabel)}</span>` : ''}</span></span>
                </a>`
            )
            .join('')}
        </div>
        <div class="academy-unit-review">
          <div>
            <strong>Knowledge check</strong>
            <small data-academy-unit-review-status>Available after all ${unit.topics.length} lessons · 5 questions</small>
          </div>
          <a data-academy-unit-review-link href="${languageRoot}/checkpoints/${unit.id}/" aria-label="Check your understanding of ${escapeHtml(unit.title)}" aria-disabled="true" tabindex="-1">Finish lessons to unlock</a>
        </div>
      </div>
    </details>`;
}

const unitSurfaceLabels = {
  dspy: 'DSPy',
  'models-signatures': 'Signatures',
  axgen: 'AxGen',
  axflow: 'AxFlow',
  axagent: 'AxAgent',
  rlm: 'RLM',
  'peek-context': 'PEEK',
  optimization: 'Optimization',
  mcp: 'Native MCP',
  notifications: 'MCP notifications',
  production: 'Production',
};

function renderDiagnostic(course, manifest) {
  const languageRoot = academyRoot(course.language);
  return academyShell(
    manifest,
    'diagnostic',
    `
      ${academyBreadcrumb('Academy', `${languageRoot}/`, 'Starting quiz')}
      <section class="academy-focus academy-diagnostic" data-academy-diagnostic>
        <span class="academy-eyebrow">Optional starting quiz · 12–15 questions</span>
        <h1>Find the right place to start.</h1>
        <p>Already know some Ax? Answer a few questions and we will skip lessons you understand. We will briefly review anything we skipped later, so a lucky guess never leaves a gap.</p>
        <div class="academy-diagnostic-intro" data-academy-diagnostic-intro>
          <ul>
            <li>The quiz samples the whole course, including topics you may not know yet.</li>
            <li>You can stop after 12 questions or answer up to 15 for a more precise result.</li>
            <li>There is no timer. Read carefully and answer what you know.</li>
          </ul>
          <button class="academy-button academy-button-primary" type="button" data-academy-diagnostic-start>Begin diagnostic</button>
          <a class="academy-button academy-diagnostic-skip" href="${topicHref(course.topicOrder[0], course.language)}">New to ax? Skip the quiz — start Lesson 1</a>
        </div>
        <div class="academy-quiz" data-academy-diagnostic-quiz hidden></div>
        <div class="academy-result" data-academy-diagnostic-result hidden aria-live="polite"></div>
      </section>
    `
  );
}

function renderTopic(course, manifest, unit, topic) {
  const languageRoot = academyRoot(course.language);
  const index = course.topicOrder.indexOf(topic.id);
  const previous = index > 0 ? course.topicOrder[index - 1] : null;
  const next =
    index + 1 < course.topicOrder.length ? course.topicOrder[index + 1] : null;
  const examplePath = topic.examplePath ?? unit.examplePaths[0];

  return academyShell(
    manifest,
    'topic',
    `
      ${academyBreadcrumb('Academy', `${languageRoot}/`, `Unit ${unit.number}`, null, topic.title)}
      <article class="academy-lesson" data-academy-topic="${topic.id}">
        <header class="academy-lesson-header">
          <span class="academy-eyebrow">Unit ${unit.number} · ${escapeHtml(unit.title)}</span>
          <h1>${escapeHtml(topic.title)}</h1>
          <p>${escapeHtml(topic.summary)}</p>
          <div class="academy-lesson-meta">${topic.apiLabel ? `<span class="academy-api-chip">${escapeHtml(topic.apiLabel)}</span>` : ''}<span>${topic.minutes} focused minutes</span><span data-academy-topic-state>Not started</span></div>
        </header>
        <section class="academy-worked-example" aria-labelledby="worked-example-title">
          <div><span class="academy-label">${topic.exampleLevel === 'unit' ? 'Unit example (nearest native match)' : 'Worked example'}</span><h2 id="worked-example-title">See the idea in context</h2></div>
          ${codeBlock(topic.example)}
          ${
            topic.exampleSteps.length
              ? `<ol class="academy-example-steps">
            ${topic.exampleSteps
              .map(
                (step) =>
                  `<li><strong>${escapeHtml(step.label)}</strong>${step.code ? codeBlock(step.code) : ''}<p>${escapeHtml(step.note)}</p></li>`
              )
              .join('')}
          </ol>`
              : ''
          }
            <div class="academy-run-example"><span class="academy-label">Run it</span><strong>In your own project</strong>${codeBlock(`${course.install}\n\n${course.quickStart}`)}<p>Set <code>OPENAI_APIKEY</code> in your environment before running provider-backed code.</p><strong>In the ax repo</strong><p>From a clone of the ax repo:</p>${codeBlock(`npm run example -- ${course.language} ${examplePath}`)}</div>
        </section>
        <section class="academy-practice" aria-labelledby="practice-title">
          <div class="academy-section-heading"><div><span class="academy-label">Active practice</span><h2 id="practice-title">Show that you can use it</h2></div><span data-academy-practice-count>Answer 2 in a row to learn this · attempt 1</span></div>
          <div class="academy-quiz" data-academy-topic-practice></div>
        </section>
        <section class="academy-sources" aria-labelledby="sources-title">
          <span class="academy-label">Keep exploring</span><h2 id="sources-title">Source-backed follow-up</h2>
          <ul>${unit.sourceRefs.map((source) => renderSourceLink(source, course.language)).join('')}${examplePath ? `<li><a href="${githubSource(examplePath)}">Source on GitHub</a></li>` : ''}</ul>
        </section>
        <nav class="academy-lesson-nav" aria-label="Course lessons">
          ${previous ? `<a href="${topicHref(previous, course.language)}">← Previous</a>` : '<span></span>'}
          ${next ? `<a href="${topicHref(next, course.language)}">Next →</a>` : `<a href="${languageRoot}/capstone/">Final project →</a>`}
        </nav>
      </article>
    `,
    { topicId: topic.id }
  );
}

function renderDailyReview(course, manifest) {
  const languageRoot = academyRoot(course.language);
  return academyShell(
    manifest,
    'review',
    `
      ${academyBreadcrumb('Academy', `${languageRoot}/`, 'Daily review')}
      <section class="academy-focus academy-daily-review" data-academy-daily-review>
        <span class="academy-eyebrow">Spaced repetition · up to 10 lessons</span>
        <h1>Strengthen what is due today.</h1>
        <p>This session mixes lessons across units, prioritizes the oldest reviews, and schedules each answer immediately.</p>
        <div class="academy-quiz" data-academy-review-queue></div>
        <div class="academy-result" data-academy-review-result hidden aria-live="polite"></div>
      </section>
    `
  );
}

function renderCheckpoint(course, manifest, unit) {
  const languageRoot = academyRoot(course.language);
  return academyShell(
    manifest,
    'checkpoint',
    `
      ${academyBreadcrumb('Academy', `${languageRoot}/`, `Unit ${unit.number} knowledge check`)}
      <section class="academy-focus" data-academy-checkpoint="${unit.id}">
        <span class="academy-eyebrow">Unit ${unit.number} review · 5 questions</span>
        <h1>Check your understanding of ${escapeHtml(unit.title)}.</h1>
        <p>Answer four out of five correctly to move on with confidence. Anything you miss will return to your learning queue for another look.</p>
        <div class="academy-quiz" data-academy-checkpoint-quiz></div>
        <div class="academy-result" data-academy-checkpoint-result hidden aria-live="polite"></div>
      </section>
    `,
    { unitId: unit.id }
  );
}

function renderCapstone(course, manifest) {
  const capstone = course.finalCapstone;
  const languageRoot = academyRoot(course.language);
  return academyShell(
    manifest,
    'capstone',
    `
      ${academyBreadcrumb('Academy', `${languageRoot}/`, 'Final project')}
      <article class="academy-lesson academy-capstone" data-academy-capstone>
        <header class="academy-lesson-header">
          <span class="academy-eyebrow">Final build · local execution</span>
          <h1>${escapeHtml(capstone.title)}</h1>
          <p>${escapeHtml(capstone.summary)}</p>
        </header>
        <section class="academy-capstone-plan">
          <span class="academy-label">Build sequence</span>
          <ol>${capstone.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
        </section>
        <section class="academy-worked-example">
          <div><span class="academy-label">Recorded MCP fixture</span><h2>Run the supporting demo locally</h2></div>
          ${codeBlock(capstone.command)}
          <p>The browser never receives a provider key. Use the repository environment for provider-backed work and recorded events for deterministic protocol checks.</p>
        </section>
        <section class="academy-practice">
          <div class="academy-section-heading"><div><span class="academy-label">Architecture check</span><h2>Connect the whole system</h2></div></div>
          <div class="academy-quiz" data-academy-capstone-quiz></div>
          <div class="academy-result" data-academy-capstone-result hidden aria-live="polite"></div>
        </section>
      </article>
    `
  );
}

function academyShell(manifest, page, body, context = {}) {
  const attributes = [
    `data-academy-page="${page}"`,
    context.topicId ? `data-topic-id="${context.topicId}"` : '',
    context.unitId ? `data-unit-id="${context.unitId}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="academy" data-academy-root ${attributes}>${compactHtml(body)}</div>
<script type="application/json" id="academy-course-data" data-pagefind-ignore>${safeJson(manifest)}</script>`;
}

function academyBreadcrumb(first, firstHref, second, secondHref, current) {
  return `<nav class="academy-breadcrumb" aria-label="Breadcrumb">
    <a href="${firstHref}">${escapeHtml(first)}</a><span>›</span>
    ${secondHref ? `<a href="${secondHref}">${escapeHtml(second)}</a><span>›</span>` : `<span>${escapeHtml(second)}</span>`}
    ${current ? `<span>${escapeHtml(current)}</span>` : ''}
  </nav>`;
}

function codeBlock(code) {
  const encodedCode = escapeHtml(code).replaceAll('\n', '&#10;');
  return `<figure class="code-block academy-code-block" data-code-block><button type="button" data-copy-code>Copy</button><pre><code>${encodedCode}</code></pre></figure>`;
}

function compactHtml(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('');
}

function topicHref(topicId, languageId) {
  return `${academyRoot(languageId)}/topics/${topicId}/`;
}

function githubSource(source) {
  return `https://github.com/ax-llm/ax/blob/main/${source}`;
}

function renderSourceLink(source, languageId) {
  const basename = path.basename(source, path.extname(source));
  const skill = basename.startsWith('ax-') ? basename : null;
  const label = sourceLabels[basename] ?? humanizeSource(basename);
  const publicPath = sourcePublicPaths[source];
  const href = publicPath
    ? `/${languageId}/${publicPath}/`
    : skill
      ? `/${languageId}/skills/${skill}/`
      : githubSource(source);
  return `<li><a href="${href}">${escapeHtml(label)}</a></li>`;
}

const sourceLabels = {
  'ax-llm': 'Ax overview and quick reference',
  'ax-ai': 'Models, providers, and routing',
  'ax-signature': 'Signatures and typed fields',
  'ax-gen': 'Reliable structured generation',
  'ax-flow': 'Workflows and orchestration',
  'ax-agent': 'Agents, tools, and delegation',
  'ax-agent-optimize': 'Agent evaluation and optimization',
  'ax-agent-memory-skills': 'Agent memory and skills',
  'ax-mcp': 'MCP clients and native capabilities',
  'ax-event-runtime': 'Events, wake, and continuations',
  'ax-gepa': 'GEPA optimization',
  'ax-learn': 'Self-improving agent patterns',
  'concept-dspy': 'Why Ax uses programs instead of prompt strings',
  'agents-long-horizon': 'Long-horizon agents',
  MCP_SUBSCRIPTIONS: 'MCP resource subscriptions',
  EVENT_RUNTIME: 'Event runtime architecture',
  SECURITY: 'Ax security guidance',
};

const sourcePublicPaths = {
  'website/content-src/templates/concept-dspy.md': 'concepts/dspy',
  'website/content-src/templates/agents-long-horizon.md': 'agents/long-horizon',
  'docs/MCP_SUBSCRIPTIONS.md': 'concepts/mcp-subscriptions',
  'docs/EVENT_RUNTIME.md': 'concepts/event-runtime',
};

function humanizeSource(value) {
  const words = value.replace(/^ax-/, '').replaceAll('-', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function readAcademySource(repoRoot) {
  return readFile(
    path.join(repoRoot, 'website/content-src/academy/course.mjs'),
    'utf8'
  );
}
