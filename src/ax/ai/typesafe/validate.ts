// cspell:ignore noul
import type {
  AxAITypesafeQuestions,
  AxAITypesafeRequest,
  AxAITypesafeResponse,
} from './types.js';

/** @internal */
export function typesafeRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Typesafe: ${label} must be an object`);
  return value as Record<string, unknown>;
}

/** @internal */
export function typesafeProbability(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error(`Typesafe: invalid probability for ${label}`);
  return value;
}

function jsonValue(
  value: unknown,
  label: string,
  ancestors = new Set<object>()
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value || ancestors.has(value))
    throw new Error(
      `Typesafe: ${label} must contain finite, non-circular JSON values`
    );
  if (
    !Array.isArray(value) &&
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error(`Typesafe: ${label} must contain plain JSON objects`);
  ancestors.add(value);
  for (const item of Array.isArray(value) ? value : Object.values(value))
    jsonValue(item, label, ancestors);
  ancestors.delete(value);
}

function entry(value: unknown, label: string): void {
  if (value !== null && typeof value !== 'string' && typeof value !== 'object')
    throw new Error(
      `Typesafe: ${label} must be text, an object, an array, or null`
    );
  jsonValue(value, label);
}

/** @internal Validates native questions for both entry points. */
export function validateTypesafeRequest(request: AxAITypesafeRequest): void {
  if (typeof request.model !== 'string' || !request.model.trim())
    throw new Error('Typesafe: model must be a nonempty string');
  entry(request.state, 'state');
  const questions = typesafeRecord(request.questions, 'questions');
  if (!Object.keys(questions).length)
    throw new Error('Typesafe: questions must not be empty');
  for (const [name, raw] of Object.entries(questions)) {
    const question = typesafeRecord(raw, `question ${name}`);
    if (question.instructions !== undefined)
      entry(question.instructions, `${name}.instructions`);
    if (question.type === 'noul') {
      if (question.criteria !== undefined && question.criteria !== null) {
        const criteria = typesafeRecord(question.criteria, `${name}.criteria`);
        for (const [key, value] of Object.entries(criteria)) {
          if (key !== 'true' && key !== 'false')
            throw new Error(`Typesafe: invalid Noul criterion ${name}.${key}`);
          entry(value, `${name}.criteria.${key}`);
        }
      }
    } else if (question.type === 'choice') {
      const criteria = typesafeRecord(question.criteria, `${name}.criteria`);
      const values = Object.values(criteria);
      if (values.length < 1 || values.length > 255)
        throw new Error(`Typesafe: Choice ${name} requires 1–255 options`);
      for (const value of values) entry(value, `${name}.criteria`);
    } else if (question.type === 'score') {
      if (
        !Array.isArray(question.criteria) ||
        question.criteria.length < 2 ||
        question.criteria.length > 10
      )
        throw new Error(`Typesafe: Score ${name} requires 2–10 levels`);
      for (const value of question.criteria) entry(value, `${name}.criteria`);
    } else throw new Error(`Typesafe: unknown question type for ${name}`);
  }
}

/** @internal Validate without changing native probabilities or score scales. */
export function decodeTypesafeResponse<Q extends AxAITypesafeQuestions>(
  raw: unknown,
  questions: Q
): AxAITypesafeResponse<Q> {
  const response = typesafeRecord(raw, 'response');
  const answers = typesafeRecord(response.answers, 'answers');
  for (const [name, question] of Object.entries(questions)) {
    if (!Object.hasOwn(answers, name))
      throw new Error(`Typesafe: missing answer for ${name}`);
    const answer = typesafeRecord(answers[name], `answer ${name}`);
    if (answer.type !== question.type)
      throw new Error(`Typesafe: incorrect answer type for ${name}`);
    if (question.type === 'noul') {
      typesafeProbability(answer.noul, name);
      continue;
    }
    typesafeProbability(answer.confidence, `${name}.confidence`);
    const probabilities = typesafeRecord(
      answer.probabilities,
      `${name}.probabilities`
    );
    const keys =
      question.type === 'choice'
        ? Object.keys(question.criteria)
        : question.criteria.map((_, i) => String(i));
    if (
      Object.keys(probabilities).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(probabilities, key))
    )
      throw new Error(
        `Typesafe: incomplete probability distribution for ${name}`
      );
    const total = keys.reduce(
      (sum, key) =>
        sum + typesafeProbability(probabilities[key], `${name}.${key}`),
      0
    );
    if (Math.abs(total - 1) > 0.01)
      throw new Error(`Typesafe: invalid probability distribution for ${name}`);
    if (question.type === 'choice') {
      if (
        typeof answer.choice !== 'string' ||
        !Object.hasOwn(question.criteria, answer.choice)
      )
        throw new Error(`Typesafe: unknown choice for ${name}`);
    } else {
      if (
        typeof answer.score !== 'number' ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > keys.length - 1
      )
        throw new Error(`Typesafe: invalid score for ${name}`);
      const legend = typesafeRecord(answer.legend, `${name}.legend`);
      if (
        Object.keys(legend).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(legend, key))
      )
        throw new Error(`Typesafe: incomplete legend for ${name}`);
      for (const value of Object.values(legend)) entry(value, `${name}.legend`);
    }
  }
  const usage = typesafeRecord(response.usage, 'usage');
  for (const value of [usage.input_tokens, usage.output_tokens]) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      throw new Error('Typesafe: invalid token usage');
  }
  if (typeof response.model !== 'string' || !response.model.trim())
    throw new Error('Typesafe: missing response model');
  return raw as AxAITypesafeResponse<Q>;
}
