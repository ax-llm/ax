export const axSpanAttributes = {
  // LLM
  LLM_SYSTEM: 'gen_ai.system',
  LLM_REQUEST_MODEL: 'gen_ai.request.model',
  LLM_REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  LLM_REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  LLM_REQUEST_TOP_K: 'gen_ai.request.top_k',
  LLM_REQUEST_FREQUENCY_PENALTY: 'gen_ai.request.frequency_penalty',
  LLM_REQUEST_PRESENCE_PENALTY: 'gen_ai.request.presence_penalty',
  LLM_REQUEST_STOP_SEQUENCES: 'gen_ai.request.stop_sequences',
  LLM_REQUEST_LLM_IS_STREAMING: 'gen_ai.request.llm_is_streaming',
  LLM_REQUEST_TOP_P: 'gen_ai.request.top_p',

  LLM_USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  LLM_USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',

  // Vector DB
  DB_SYSTEM: 'db.system',
  DB_TABLE: 'db.table',
  DB_NAMESPACE: 'db.namespace',
  DB_ID: 'db.id',
  DB_QUERY_TEXT: 'db.query.text',
  DB_VECTOR: 'db.vector',
  DB_OPERATION_NAME: 'db.operation.name',
  DB_VECTOR_QUERY_TOP_K: 'db.vector.query.top_k',

  DB_QUERY_EMBEDDINGS: 'db.query.embeddings',
  DB_QUERY_RESULT: 'db.query.result',

  // Query Embeddings
  DB_QUERY_EMBEDDINGS_VECTOR: 'db.query.embeddings.vector',

  // Query Result (canonical format)
  DB_QUERY_RESULT_ID: 'db.query.result.id',
  DB_QUERY_RESULT_SCORE: 'db.query.result.score',
  DB_QUERY_RESULT_DISTANCE: 'db.query.result.distance',
  DB_QUERY_RESULT_METADATA: 'db.query.result.metadata',
  DB_QUERY_RESULT_VECTOR: 'db.query.result.vector',
  DB_QUERY_RESULT_DOCUMENT: 'db.query.result.document',
}

export const axSpanEvents = {
  LLM_PROMPT: 'gen_ai.prompt',
}

export enum AxLLMRequestTypeValues {
  COMPLETION = 'completion',
  CHAT = 'chat',
  RERANK = 'rerank',
  UNKNOWN = 'unknown',
}

export enum AxSpanKindValues {
  WORKFLOW = 'workflow',
  TASK = 'task',
  AGENT = 'agent',
  TOOL = 'tool',
  UNKNOWN = 'unknown',
}
