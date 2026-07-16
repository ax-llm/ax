export const choice = (prompt, choices, answer, explanation) => ({
  type: 'choice',
  prompt,
  choices,
  answer,
  explanation,
});

export const code = (prompt, answer, explanation, alternatives = []) => ({
  type: 'code',
  prompt,
  answer,
  alternatives,
  explanation,
});

export const topic = ({
  id,
  title,
  prerequisites = [],
  minutes = 7,
  summary,
  example,
  exampleSteps,
  check,
  checks,
  apiSymbols = [],
}) => {
  const bank = checks ?? academyQuestionBanks[id];
  const diagnostic = bank?.diagnostic ?? check;
  const practice = bank?.practice ?? (check ? [check, check] : []);
  const review = bank?.review ?? (check ? [check] : []);
  return {
    id,
    title,
    prerequisites,
    minutes,
    summary,
    example,
    exampleSteps: exampleSteps ?? [
      {
        label: 'Identify the boundary',
        note: `Start from the governing rule: ${summary}`,
      },
      {
        label: 'Trace the example',
        note: 'Locate the declared input, output, state, or capability boundary before focusing on syntax.',
      },
      {
        label: 'Predict a change',
        note: 'Change one condition mentally and identify which contract or runtime behavior must remain stable.',
      },
    ],
    apiSymbols,
    exercises: [
      diagnostic
        ? { ...diagnostic, id: `${id}-diagnostic`, roles: ['diagnostic'] }
        : null,
      ...practice.map((exercise, index) => ({
        ...exercise,
        id: `${id}-practice-${index + 1}`,
        roles: ['practice'],
      })),
      ...review.map((exercise, index) => ({
        ...exercise,
        id: `${id}-review-${index + 1}`,
        roles: ['review'],
      })),
    ].filter(Boolean),
  };
};

import { academyQuestionBanks } from './question-banks.mjs';
