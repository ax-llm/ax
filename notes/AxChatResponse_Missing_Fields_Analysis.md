# AxChatResponse Missing Fields Analysis

This document analyzes the current `AxChatResponse` interface against the
response structures of major LLM providers (OpenAI, Gemini, Anthropic, Cohere)
to identify commonly supported fields that might be missing.

## Current AxChatResponse Structure

```typescript
export type AxChatResponse = {
  sessionId?: string;
  remoteId?: string;
  results: readonly AxChatResponseResult[];
  modelUsage?: AxModelUsage;
};

export type AxChatResponseResult = {
  index: number;
  content?: string;
  thought?: string;
  name?: string;
  id?: string;
  functionCalls?: {
    id: string;
    type: "function";
    function: { name: string; params?: string | object };
  }[];
  annotations?: {
    type: "url_citation";
    url_citation: {
      url: string;
      title?: string;
      description?: string;
    };
  }[];
  finishReason?:
    | "stop"
    | "length"
    | "function_call"
    | "content_filter"
    | "error";
};
```

## Provider Response Structures Summary

### OpenAI Chat Completions API

- **Core Fields**: `id`, `object`, `created`, `model`, `system_fingerprint`,
  `service_tier`
- **Choices**: Array with `message`, `finish_reason`, `logprobs`
- **Usage**: `prompt_tokens`, `completion_tokens`, `total_tokens`,
  `completion_tokens_details.reasoning_tokens`
- **Message Fields**: `role`, `content`, `refusal`, `tool_calls`, `parsed`

### Google Gemini API

- **Core Fields**: `candidates`, `promptFeedback`, `usageMetadata`,
  `modelVersion`, `createTime`, `responseId`
- **Safety**: Comprehensive `safetyRatings` with harm categories and
  probabilities
- **Citations**: Rich `citationMetadata` with URIs, titles, licenses,
  publication dates
- **Grounding**: `groundingMetadata` with web search queries, confidence scores
- **Usage**: `promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`,
  `cachedContentTokenCount`

### Anthropic Claude Messages API

- **Core Fields**: `id`, `type`, `role`, `model`, `stop_reason`, `stop_sequence`
- **Content**: Rich content blocks including `thinking` type
- **Usage**: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`, `service_tier`
- **Headers**: Comprehensive rate limiting headers

### Cohere Chat API

- **Core Fields**: `id`, `finish_reason`, `message`, `usage`, `meta`
- **Citations**: Detailed citations with document sources, snippets, precise
  text mapping
- **Tool Use**: `tool_calls`, `tool_plan` (reasoning for tool usage)
- **Probabilities**: `logprobs` with token probabilities and top alternatives

## Missing Fields Analysis

### 🔴 Critical Missing Fields

#### 1. **Timestamps**

- **Missing**: Response creation/completion timestamps
- **Providers**: OpenAI (`created`), Gemini (`createTime`)
- **Use Case**: Debugging, analytics, caching strategies
- **Suggested Addition**:

```typescript
createdAt?: number; // Unix timestamp
completedAt?: number; // Unix timestamp for streaming completion
```

#### 2. **System Fingerprint/Version Tracking**

- **Missing**: System configuration identification
- **Providers**: OpenAI (`system_fingerprint`), Gemini (`modelVersion`)
- **Use Case**: Reproducibility, determinism tracking, model versioning
- **Suggested Addition**:

```typescript
systemFingerprint?: string; // Provider system configuration ID
modelVersion?: string; // Specific model version used
```

#### 3. **Enhanced Token Usage Details**

- **Missing**: Detailed token breakdown beyond basic usage
- **Providers**:
  - OpenAI: `completion_tokens_details.reasoning_tokens`
  - Anthropic: `cache_creation_input_tokens`, `cache_read_input_tokens`,
    `service_tier`
  - Gemini: `cachedContentTokenCount`
- **Use Case**: Cost optimization, cache efficiency tracking, reasoning model
  usage
- **Suggested Enhancement**:

```typescript
export type AxTokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thoughtsTokens?: number; // Already exists
  // New additions:
  reasoningTokens?: number; // For O1-style models
  cacheCreationTokens?: number; // Cost of creating cache entries
  cacheReadTokens?: number; // Tokens read from cache (often free)
  serviceTier?: "standard" | "priority" | "batch"; // Service level used
};
```

### 🟡 Important Missing Fields

#### 4. **Log Probabilities**

- **Missing**: Token probability information
- **Providers**: OpenAI (`logprobs`), Gemini (`logprobsResult`), Cohere
  (`logprobs`)
- **Use Case**: Model confidence analysis, uncertainty quantification
- **Suggested Addition**:

```typescript
logprobs?: {
  content?: {
    token: string;
    logprob: number;
    topLogprobs?: { token: string; logprob: number }[];
  }[];
};
```

#### 5. **Safety and Content Filtering**

- **Missing**: Safety ratings and content filtering details
- **Providers**: Gemini (comprehensive safety system), Anthropic (refusal
  tracking)
- **Use Case**: Content moderation, safety compliance, debugging blocked
  responses
- **Suggested Addition**:

```typescript
safetyRatings?: {
  category: string; // harassment, hate_speech, etc.
  probability: 'negligible' | 'low' | 'medium' | 'high';
  blocked?: boolean;
}[];
promptFeedback?: {
  blockReason?: string; // Why prompt was blocked
  safetyRatings?: SafetyRating[];
};
```

#### 6. **Enhanced Citations**

- **Missing**: Rich citation metadata beyond basic URL citations
- **Providers**:
  - Gemini: license, publication date, confidence scores
  - Cohere: document snippets, precise text mapping
- **Use Case**: Academic research, legal compliance, source verification
- **Suggested Enhancement**:

```typescript
annotations?: {
  type: 'url_citation';
  url_citation: {
    url: string;
    title?: string;
    description?: string;
    // New additions:
    license?: string; // Content license information
    publicationDate?: string; // ISO date string
    snippet?: string; // Relevant text excerpt
    confidenceScore?: number; // 0-1 confidence in citation
  };
}[];
```

### 🟢 Nice-to-Have Missing Fields

#### 7. **Tool Use Context**

- **Missing**: Tool planning and reasoning context
- **Providers**: Cohere (`tool_plan`), Gemini
  (`automaticFunctionCallingHistory`)
- **Use Case**: Debugging tool use, understanding AI reasoning
- **Suggested Addition**:

```typescript
toolPlan?: string; // Model's reasoning for tool usage
toolHistory?: { // Complete function calling interaction trace
  functionCall: object;
  functionResult: object;
  timestamp: number;
}[];
```

#### 8. **Response Context and Grounding**

- **Missing**: Context about how response was generated
- **Providers**: Gemini (`groundingMetadata` with web search queries)
- **Use Case**: RAG debugging, understanding information sources
- **Suggested Addition**:

```typescript
groundingContext?: {
  searchQueries?: string[]; // Queries used for grounding
  documentSources?: string[]; // Document IDs used
  retrievalMetadata?: object; // RAG-specific metadata
};
```

#### 9. **Refusal and Error Details**

- **Missing**: Detailed refusal tracking
- **Providers**: OpenAI (`refusal`), Anthropic (refusal in content), Gemini
  (safety blocks)
- **Use Case**: Understanding why requests fail or are refused
- **Suggested Addition**:

```typescript
refusal?: {
  reason: string; // Human-readable refusal reason
  category: 'safety' | 'policy' | 'capability' | 'other';
  details?: string; // Additional context
};
```

## Implementation Priority Recommendations

### Phase 1: Critical Fields (Immediate)

1. **Timestamps** - Essential for debugging and analytics
2. **System Fingerprint** - Important for reproducibility
3. **Enhanced Token Usage** - Critical for cost optimization

### Phase 2: Important Fields (Next Release)

4. **Log Probabilities** - Valuable for confidence analysis
5. **Enhanced Citations** - Important for RAG applications
6. **Safety Ratings** - Essential for production safety

### Phase 3: Nice-to-Have Fields (Future)

7. **Tool Use Context** - Helpful for debugging
8. **Grounding Context** - Useful for RAG applications
9. **Refusal Details** - Good for error handling

## Backward Compatibility Considerations

All suggested additions use optional fields (`?`) to maintain backward
compatibility. The core structure of `AxChatResponse` remains unchanged, with
enhancements primarily focused on:

1. **Extending existing types** (like `AxTokenUsage`)
2. **Adding optional metadata fields**
3. **Enhancing existing structures** (like citations)

## Provider-Specific Implementation Notes

- **OpenAI**: Focus on `system_fingerprint`, `reasoning_tokens`, `logprobs`
- **Gemini**: Rich `safetyRatings`, `citationMetadata`, `groundingMetadata`
- **Anthropic**: Cache token tracking, `service_tier`, content refusals
- **Cohere**: `tool_plan`, detailed citations with document sources

This analysis provides a roadmap for enhancing `AxChatResponse` to better align
with modern LLM provider capabilities while maintaining the framework's
provider-agnostic design.
