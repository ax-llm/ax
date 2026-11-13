// cspell:ignore noul youtu
import type {
  AxAIGoogleGeminiDecisionsQuestions,
  AxAIGoogleGeminiDecisionsRequest,
  AxAIGoogleGeminiDecisionsResponse,
} from './types.js';

/** @internal */
export function decisionRecord(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Google Gemini Decisions: ${label} must be an object`);
  return value as Record<string, unknown>;
}
/** @internal */
export function decisionProbability(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error(
      `Google Gemini Decisions: invalid probability for ${label}`
    );
  return value;
}
function text(value: unknown, label: string, nonempty = false): string {
  if (typeof value !== 'string' || (nonempty && !value.trim()))
    throw new Error(
      `Google Gemini Decisions: ${label} must be ${nonempty ? 'nonempty ' : ''}text`
    );
  return value;
}
function textContent(value: unknown, label: string): void {
  const blocks = Array.isArray(value) ? value : [value];
  let joined = '';
  for (const block of blocks) {
    if (typeof block === 'string' && !Array.isArray(value)) {
      joined += block;
      continue;
    }
    const part = decisionRecord(block, label);
    if (part.type !== 'text')
      throw new Error(`Google Gemini Decisions: ${label} accepts text only`);
    joined += text(part.text, label);
  }
  text(joined, label, true);
}
function input(value: unknown): void {
  if (typeof value === 'string') {
    text(value, 'input', true);
    return;
  }
  const blocks = Array.isArray(value) ? value : [value];
  if (!blocks.length)
    throw new Error('Google Gemini Decisions: input cannot be empty');
  let bytes = 0;
  let pdfBytes = 0;
  let hasContent = false;
  for (const raw of blocks) {
    const block = decisionRecord(raw, 'input block');
    if (block.type === 'text') {
      const content = text(block.text, 'input text');
      hasContent = !!content.trim() || hasContent;
      continue;
    }
    if (!['image', 'audio', 'video', 'document'].includes(String(block.type)))
      throw new Error('Google Gemini Decisions: unsupported input block');
    const mime = text(block.mime_type, 'mime_type', true);
    if (
      block.type === 'document'
        ? mime !== 'application/pdf'
        : !mime.startsWith(`${block.type}/`)
    )
      throw new Error(
        'Google Gemini Decisions: MIME type must match the input block type (documents must be PDF)'
      );
    if (
      block.resolution !== undefined &&
      (!['image', 'video'].includes(String(block.type)) ||
        !['low', 'medium', 'high', 'ultra_high'].includes(
          String(block.resolution)
        ) ||
        (block.type === 'video' && block.resolution === 'ultra_high'))
    )
      throw new Error('Google Gemini Decisions: invalid media resolution');
    if ((block.data === undefined) === (block.uri === undefined))
      throw new Error(
        'Google Gemini Decisions: media requires exactly one of data or uri'
      );
    if (block.data !== undefined) {
      const data = text(block.data, 'media data', true);
      if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
        throw new Error(
          'Google Gemini Decisions: media data must be base64 without a data URL prefix'
        );
      const size =
        (data.length / 4) * 3 -
        (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
      bytes += size;
      if (block.type === 'document') pdfBytes += size;
    } else {
      const uri = new URL(text(block.uri, 'media URI', true));
      if (
        uri.protocol !== 'https:' ||
        /(^|\.)(youtube\.com|youtu\.be)$/i.test(uri.hostname)
      )
        throw new Error(
          'Google Gemini Decisions: media URI must be a Files API or public HTTPS URL; YouTube is unsupported'
        );
    }
    hasContent = true;
  }
  if (!hasContent)
    throw new Error('Google Gemini Decisions: input cannot be empty');
  if (bytes > 100 * 1024 * 1024 || pdfBytes > 50 * 1024 * 1024)
    throw new Error(
      'Google Gemini Decisions: inline media exceeds 100 MB (50 MB for PDFs)'
    );
}
/** @internal */
export function validateDecisionsRequest(
  request: AxAIGoogleGeminiDecisionsRequest
): void {
  text(request.model, 'model', true);
  input(request.input);
  const questions = decisionRecord(request.questions, 'questions');
  if (Object.keys(questions).length < 1 || Object.keys(questions).length > 1000)
    throw new Error('Google Gemini Decisions: requires 1–1000 questions');
  for (const [key, raw] of Object.entries(questions)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key))
      throw new Error(
        'Google Gemini Decisions: question keys must contain 1–64 ASCII letters, digits, underscores or hyphens'
      );
    const question = decisionRecord(raw, `question ${key}`);
    textContent(question.instructions, `${key}.instructions`);
    if (question.type === 'noul') {
      if (question.criteria !== undefined) {
        const criteria = decisionRecord(question.criteria, `${key}.criteria`);
        for (const [name, value] of Object.entries(criteria)) {
          if (!['true_description', 'false_description'].includes(name))
            throw new Error(
              `Google Gemini Decisions: unknown noul criterion ${name}`
            );
          text(value, `${key}.criteria.${name}`);
        }
      }
    } else if (question.type === 'choice') {
      const criteria = decisionRecord(question.criteria, `${key}.criteria`);
      if (
        Object.keys(criteria).length < 2 ||
        Object.keys(criteria).length > 255
      )
        throw new Error(
          `Google Gemini Decisions: choice ${key} requires 2–255 options`
        );
      for (const [name, value] of Object.entries(criteria)) {
        if (
          !name ||
          [...name].length > 128 ||
          new TextEncoder().encode(name).length > 512 ||
          name.trim() !== name ||
          /[\p{Cc}\p{Zl}\p{Zp}]|[^\S ]/u.test(name)
        )
          throw new Error(
            `Google Gemini Decisions: invalid option key for ${key}`
          );
        text(value, `${key}.criteria.${name}`);
      }
    } else if (question.type === 'score') {
      if (
        !Array.isArray(question.criteria) ||
        question.criteria.length < 2 ||
        question.criteria.length > 255
      )
        throw new Error(
          `Google Gemini Decisions: score ${key} requires 2–255 levels`
        );
      for (const level of question.criteria)
        text(level, `${key}.criteria`, true);
    } else
      throw new Error(
        `Google Gemini Decisions: unknown question type for ${key}`
      );
  }
}
function tokenCount(value: unknown): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Google Gemini Decisions: invalid token usage');
}
/** @internal Preserve native answers, including rounded distributions, without renormalizing. */
export function decodeDecisionsResponse<
  Q extends AxAIGoogleGeminiDecisionsQuestions,
>(raw: unknown, questions: Q): AxAIGoogleGeminiDecisionsResponse<Q> {
  const response = decisionRecord(raw, 'response');
  const answers = decisionRecord(response.answers, 'answers');
  if (Object.keys(answers).length !== Object.keys(questions).length)
    throw new Error(
      'Google Gemini Decisions: answer keys must match question keys'
    );
  for (const [key, question] of Object.entries(questions)) {
    if (!Object.hasOwn(answers, key))
      throw new Error(`Google Gemini Decisions: missing answer for ${key}`);
    const answer = decisionRecord(answers[key], `answer ${key}`);
    if (answer.type !== question.type)
      throw new Error(
        `Google Gemini Decisions: incorrect answer type for ${key}`
      );
    decisionProbability(answer.confidence, `${key}.confidence`);
    if (question.type === 'noul') {
      const p = decisionProbability(answer.noul, key);
      if (p < 0.01 || p > 0.99)
        throw new Error(
          `Google Gemini Decisions: noul for ${key} must be in [0.01, 0.99]`
        );
      continue;
    }
    const probabilities = decisionRecord(
      answer.probabilities,
      `${key}.probabilities`
    );
    const keys =
      question.type === 'choice'
        ? Object.keys(question.criteria)
        : question.criteria.map((_, i) => String(i));
    if (
      Object.keys(probabilities).length !== keys.length ||
      keys.some((k) => !Object.hasOwn(probabilities, k))
    )
      throw new Error(
        `Google Gemini Decisions: incomplete probability distribution for ${key}`
      );
    const total = keys.reduce(
      (sum, k) => sum + decisionProbability(probabilities[k], `${key}.${k}`),
      0
    );
    if (Math.abs(total - 1) > 0.01 + Number.EPSILON * keys.length)
      throw new Error(
        `Google Gemini Decisions: invalid probability distribution for ${key}`
      );
    if (question.type === 'choice') {
      if (
        typeof answer.choice !== 'string' ||
        !Object.hasOwn(question.criteria, answer.choice)
      )
        throw new Error(`Google Gemini Decisions: unknown choice for ${key}`);
    } else {
      if (
        typeof answer.score !== 'number' ||
        !Number.isFinite(answer.score) ||
        answer.score < 0 ||
        answer.score > keys.length - 1
      )
        throw new Error(`Google Gemini Decisions: invalid score for ${key}`);
      const legend = decisionRecord(answer.legend, `${key}.legend`);
      if (
        Object.keys(legend).length !== keys.length ||
        keys.some((k, i) => legend[k] !== question.criteria[i])
      )
        throw new Error(`Google Gemini Decisions: invalid legend for ${key}`);
    }
  }
  const usage = decisionRecord(response.usage, 'usage');
  for (const value of [
    usage.total_input_tokens,
    usage.total_output_tokens,
    usage.total_tokens,
  ])
    tokenCount(value);
  if (
    usage.total_output_tokens !== 0 ||
    usage.total_tokens !== usage.total_input_tokens
  )
    throw new Error('Google Gemini Decisions: expected zero output tokens');
  if (usage.input_tokens_by_modality !== undefined) {
    if (!Array.isArray(usage.input_tokens_by_modality))
      throw new Error('Google Gemini Decisions: invalid modality usage');
    for (const raw of usage.input_tokens_by_modality) {
      const entry = decisionRecord(raw, 'modality usage');
      if (!['text', 'image', 'audio'].includes(String(entry.modality)))
        throw new Error('Google Gemini Decisions: invalid usage modality');
      tokenCount(entry.tokens);
    }
  }
  return raw as AxAIGoogleGeminiDecisionsResponse<Q>;
}
