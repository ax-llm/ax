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
  apiLabel,
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
    apiLabel,
    summary,
    example,
    exampleSteps: exampleSteps ?? [],
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
