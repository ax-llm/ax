import type {
  AxAIOpenAIDecisionQuestion,
  AxAIOpenAIDecisionsRequest,
  AxAIOpenAIDecisionsResponse,
} from './types.js';

export function decisionRecord(
  value: unknown,
  path: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`OpenAI Decisions: invalid ${path}`);
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string')
    throw new Error(`OpenAI Decisions: invalid ${path}`);
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`OpenAI Decisions: invalid ${path}`);
}
export function decisionProbability(value: unknown, path: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw new Error(`OpenAI Decisions: invalid probability for ${path}`);
  return value;
}
function count(value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`OpenAI Decisions: invalid ${path}`);
}
export function validateDecisionsRequest(
  request: AxAIOpenAIDecisionsRequest
): void {
  text(request.model, 'model');
  if (request.safety_identifier != null)
    string(request.safety_identifier, 'safety_identifier');
  let images = 0;
  if (typeof request.input !== 'string') {
    if (!Array.isArray(request.input) || !request.input.length)
      throw new Error('OpenAI Decisions: input must be text or user messages');
    for (const raw of request.input) {
      const message = decisionRecord(raw, 'input message');
      if (
        message.role !== 'user' ||
        (message.type !== undefined && message.type !== 'message')
      )
        throw new Error('OpenAI Decisions: only user messages are supported');
      if (typeof message.content === 'string') continue;
      if (!Array.isArray(message.content) || !message.content.length)
        throw new Error('OpenAI Decisions: invalid input content');
      for (const rawPart of message.content) {
        const part = decisionRecord(rawPart, 'input part');
        if (part.type === 'input_text' && typeof part.text === 'string')
          continue;
        if (
          part.type !== 'input_image' ||
          typeof part.image_url !== 'string' ||
          !/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/]+={0,2}$/.test(
            part.image_url
          )
        )
          throw new Error(
            'OpenAI Decisions: images require inline base64 data URLs; files, audio, and hosted URLs are unsupported'
          );
        if (
          part.detail != null &&
          !['low', 'high', 'auto', 'original'].includes(String(part.detail))
        )
          throw new Error('OpenAI Decisions: invalid image detail');
        images++;
      }
    }
  }
  if (images > 128)
    throw new Error('OpenAI Decisions: at most 128 images are supported');
  if (!Array.isArray(request.questions) || !request.questions.length)
    throw new Error('OpenAI Decisions: at least one question is required');
  const names = new Set<string>();
  for (const raw of request.questions) {
    const q = decisionRecord(raw, 'question');
    string(q.instructions, 'question instructions');
    if (q.name !== undefined) {
      string(q.name, 'question name');
      if (names.has(q.name))
        throw new Error('OpenAI Decisions: duplicate question name');
      names.add(q.name);
    }
    if (q.type === 'predicate') continue;
    const options =
      q.type === 'choice'
        ? q.choices
        : q.type === 'score'
          ? q.levels
          : undefined;
    if (!Array.isArray(options))
      throw new Error('OpenAI Decisions: invalid question type or options');
    const max = q.type === 'score' ? 10 : 255;
    if (options.length < 2 || options.length > max)
      throw new Error(`OpenAI Decisions: ${q.type} requires 2–${max} options`);
    const values = new Set<string | boolean>();
    for (const rawOption of options) {
      const option = decisionRecord(rawOption, 'question option');
      const value = q.type === 'choice' ? option.value : option.label;
      if (q.type === 'score' || typeof value !== 'boolean')
        string(value, 'option value');
      if (values.has(value as string | boolean))
        throw new Error('OpenAI Decisions: duplicate option value');
      values.add(value as string | boolean);
      if (
        option.description !== undefined &&
        typeof option.description !== 'string'
      )
        throw new Error('OpenAI Decisions: invalid option description');
    }
  }
}
export function decodeDecisionsResponse<
  Q extends readonly AxAIOpenAIDecisionQuestion[],
>(raw: unknown, questions: Q): AxAIOpenAIDecisionsResponse<Q> {
  const response = decisionRecord(raw, 'response');
  text(response.model, 'response model');
  if (
    !Array.isArray(response.answers) ||
    response.answers.length !== questions.length
  )
    throw new Error('OpenAI Decisions: incomplete answers');
  for (const [i, q] of questions.entries()) {
    const a = decisionRecord(response.answers[i], `answer ${i}`);
    if (a.name !== (q.name ?? null))
      throw new Error('OpenAI Decisions: incorrect answer name or order');
    if (a.type === 'refusal') continue;
    if (a.type !== q.type)
      throw new Error('OpenAI Decisions: incorrect answer type');
    if (q.type === 'predicate') {
      decisionProbability(a.probability, 'predicate');
      continue;
    }
    decisionProbability(a.confidence, 'confidence');
    const values =
      q.type === 'choice'
        ? q.choices.map((c) => c.value)
        : q.levels.map((_, i) => i);
    if (
      !Array.isArray(a.probabilities) ||
      a.probabilities.length !== values.length
    )
      throw new Error('OpenAI Decisions: incomplete probabilities');
    const seen = new Set<unknown>();
    let total = 0;
    for (const rawP of a.probabilities) {
      const p = decisionRecord(rawP, 'probability');
      if (!values.some((v) => v === p.value) || seen.has(p.value))
        throw new Error(
          'OpenAI Decisions: unknown or duplicate probability value'
        );
      seen.add(p.value);
      total += decisionProbability(p.probability, 'distribution');
      if (q.type === 'score' && p.label !== q.levels[p.value as number]?.label)
        throw new Error('OpenAI Decisions: incorrect score label');
    }
    if (Math.abs(total - 1) > 0.01 + Number.EPSILON * values.length)
      throw new Error('OpenAI Decisions: invalid probability distribution');
    if (q.type === 'choice' && !values.some((v) => v === a.choice))
      throw new Error('OpenAI Decisions: unknown choice');
    if (
      q.type === 'score' &&
      (typeof a.score !== 'number' ||
        !Number.isFinite(a.score) ||
        a.score < 0 ||
        a.score > values.length - 1)
    )
      throw new Error('OpenAI Decisions: invalid score');
  }
  const usage = decisionRecord(response.usage, 'usage');
  for (const k of ['input_tokens', 'output_tokens', 'total_tokens'])
    count(usage[k], k);
  const input = decisionRecord(
    usage.input_tokens_details,
    'input token details'
  );
  count(input.cached_tokens, 'cached tokens');
  count(input.cache_write_tokens, 'cache write tokens');
  count(
    decisionRecord(usage.output_tokens_details, 'output token details')
      .reasoning_tokens,
    'reasoning tokens'
  );
  return raw as AxAIOpenAIDecisionsResponse<Q>;
}
