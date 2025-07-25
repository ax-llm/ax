# AxChatRequest Media Support Analysis

This document analyzes how different AI providers in the Ax framework handle images, audio, files, and links within their AxChatRequest implementations, including detailed implementation analysis of the `createChatReq` and `createChatResp` methods.

## Key Implementation Findings

### Media Content Transformation Patterns
1. **Base64 Handling**: All providers that support images expect base64-encoded data, but transform it differently:
   - OpenAI: Converts to data URLs (`data:${mimeType};base64,${image}`)
   - Gemini: Uses direct base64 in `inlineData.data` field
   - Anthropic: Places base64 in `source.data` with separate `media_type`

2. **Error Handling Strategies**:
   - **Graceful Continuation**: OpenAI processes supported content, ignores unsupported
   - **Explicit Rejection**: Gemini, Anthropic, and Cohere throw specific error messages
   - **Early Validation**: Cohere rejects any non-string content immediately

3. **Content Type Support Gaps**:
   - Audio is only supported by OpenAI via direct mapping
   - Files require special handling (OpenAI file uploads, Gemini cloud storage)
   - Links/URLs need preprocessing or provider-specific tools (Gemini search)

### Response Processing Consistency
All providers follow similar patterns for `createChatResp`:
- Extract token usage and map to `AxTokenUsage` format
- Convert provider-specific function calls to `AxChatResponseResult.functionCalls`
- Handle streaming deltas vs. complete responses
- Map provider errors to Ax framework error types (`AxAIRefusalError`)

## Universal AxChatRequest Structure

The base `AxChatRequest` type (in `src/ax/ai/types.ts`) defines a universal structure that all providers map from:

```typescript
export type AxChatRequest = {
  chatPrompt: (
    | { role: 'system'; content: string; cache?: boolean }
    | {
        role: 'user';
        content:
          | string
          | (
              | { type: 'text'; text: string; cache?: boolean }
              | { type: 'image'; mimeType: string; image: string; details?: 'high' | 'low' | 'auto'; cache?: boolean }
              | { type: 'audio'; data: string; format?: 'wav'; cache?: boolean }
            )[];
      }
    | { role: 'assistant'; content?: string; name?: string; functionCalls?: [...]; cache?: boolean }
    | { role: 'function'; result: string; isError?: boolean; functionId: string; cache?: boolean }
  )[];
  // ... other fields
};
```

## Provider-Specific Media Handling

### 1. OpenAI

#### Chat API (`AxAIOpenAIChatRequest`)
**Images:**
- ✅ **Supported** via `image_url` type
- Format: `{ type: 'image_url', image_url: { url: string, details?: 'high' | 'low' | 'auto' } }`
- Maps from AxChatRequest `image` field (base64 encoded) to `data:` URL

**Audio:**
- ✅ **Supported** via `input_audio` type
- Format: `{ type: 'input_audio', input_audio: { data: string, format?: 'wav' } }`
- Direct mapping from AxChatRequest `audio` field

**Files:**
- ✅ **Supported** via `file` type
- Format: `{ type: 'file', file: { file_data: string, filename: string } }`
- *Note: Not present in universal AxChatRequest - provider-specific extension*

**Links:**
- ❌ **Not directly supported** - would need to be embedded in text content
- Web search available via `web_search_options` configuration

#### Responses API (`AxAIOpenAIResponsesRequest`)
**Images:**
- ✅ **Supported** via `image_url` input content part
- Format: `{ type: 'image_url', image_url: { url: string, details?: 'low' | 'high' | 'auto' } }`

**Audio:**
- ✅ **Supported** via `input_audio` content part
- Format: `{ type: 'input_audio', input_audio: { data: string, format?: string } }`

**Files:**
- ❌ **Not explicitly supported** in the responses API schema shown
- May support file uploads through separate mechanisms

**Links:**
- ❌ **Not directly supported** - text-based inclusion only

### 2. Google Gemini

#### Request Structure (`AxAIGoogleGeminiChatRequest`)
**Images:**
- ✅ **Supported** via `inlineData` content part
- Format: `{ inlineData: { mimeType: string, data: string } }`
- Maps from AxChatRequest `image` field with mimeType conversion

**Audio:**
- ✅ **Supported** via `inlineData` content part (same as images)
- Format: `{ inlineData: { mimeType: string, data: string } }`
- Uses audio-specific MIME types (e.g., `audio/wav`)

**Files:**
- ✅ **Supported** via `fileData` content part
- Format: `{ fileData: { mimeType: string, fileUri: string } }`
- Requires file upload to Google Cloud Storage first

**Links:**
- ✅ **Partially Supported** via `google_search_retrieval` tool
- Can perform web searches with dynamic retrieval
- URL context support via `url_context` configuration

### 3. Anthropic Claude

#### Request Structure (`AxAIAnthropicChatRequest`)
**Images:**
- ✅ **Supported** via base64 image content parts
- Format: `{ type: 'image', source: { type: 'base64', media_type: string, data: string } }`
- Maps directly from AxChatRequest `image` field
- Supports caching via `cache_control` parameter

**Audio:**
- ❌ **Not supported** - no audio input content types available
- Audio data would need to be transcribed to text first

**Files:**  
- ❌ **Not directly supported** - no file content type
- File contents would need to be extracted to text/images

**Links:**
- ❌ **Not directly supported** - no web search or URL retrieval
- Links must be processed as text content

### 4. Cohere

#### Request Structure (`AxAICohereChatRequest`)
**Images:**
- ❌ **Not supported** - no image content types in chat history
- Only supports text-based `message` fields

**Audio:**
- ❌ **Not supported** - no audio content types available

**Files:**
- ❌ **Not supported** - no file attachment mechanisms

**Links:**
- ❌ **Not directly supported** - text inclusion only
- No built-in web search or URL retrieval capabilities

## Summary Matrix

| Provider | Images | Audio | Files | Links/URLs | Notes |
|----------|--------|-------|-------|------------|-------|
| **OpenAI Chat** | ✅ High/Low/Auto detail | ✅ WAV format | ✅ File uploads | ❌ Text only | Most comprehensive media support |
| **OpenAI Responses** | ✅ Detail levels | ✅ Multi-format | ❌ Limited | ❌ Text only | Advanced streaming, limited file support |
| **Google Gemini** | ✅ Inline + Cloud | ✅ Inline + Cloud | ✅ Cloud Storage | ✅ Search integration | Best URL/search support |
| **Anthropic** | ✅ Base64 + Caching | ❌ Not supported | ❌ Not supported | ❌ Text only | Strong image support, limited media types |
| **Cohere** | ❌ Not supported | ❌ Not supported | ❌ Not supported | ❌ Text only | Text-focused, no media capabilities |

## Key Implementation Patterns

### Image Handling
- **OpenAI**: Converts base64 to `data:` URLs for `image_url` type
- **Gemini**: Uses `inlineData` with `mimeType` and base64 `data`
- **Anthropic**: Uses `source.data` with `media_type` specification
- **Cohere**: No image support

### Audio Handling
- **OpenAI**: Dedicated `input_audio` type with format specification
- **Gemini**: Reuses `inlineData` pattern with audio MIME types
- **Anthropic**: No native audio support
- **Cohere**: No audio support

### File Handling
- **OpenAI Chat**: Direct file upload via `file` type with `file_data` and `filename`
- **Gemini**: Requires cloud storage upload, references via `fileUri`
- **Others**: No direct file support

### Link/URL Handling
- **Gemini**: Built-in web search and URL context tools
- **Others**: Manual text inclusion or preprocessing required

## Caching Support

Only **Anthropic** provides explicit caching controls via `cache_control: { type: 'ephemeral' }` parameters on content parts, which can help optimize repeated media usage.

## Implementation Analysis: createChatReq Methods

This section details how each provider's `createChatReq` method transforms the universal `AxChatRequest` content into provider-specific request formats.

### 1. OpenAI Implementation

**File**: `src/ax/ai/openai/api.ts`

**Key Method**: `createMessages()` function within `createChatReq()`

**Media Handling**:
```typescript
case 'user': {
  const content: UserContent = Array.isArray(msg.content)
    ? msg.content.map((c) => {
        switch (c.type) {
          case 'text':
            return { type: 'text' as const, text: c.text };
          case 'image': {
            // Converts base64 to data URL
            const url = `data:${c.mimeType};base64,${c.image}`;
            return {
              type: 'image_url' as const,
              image_url: { url, details: c.details ?? 'auto' },
            };
          }
          case 'audio': {
            return {
              type: 'input_audio' as const,
              input_audio: { data: c.data, format: c.format ?? 'wav' },
            };
          }
        }
      })
    : msg.content;
}
```

**Response Handling**: `createChatResp()` extracts content and function calls from OpenAI response format, handling refusals via `AxAIRefusalError`.

### 2. Google Gemini Implementation  

**File**: `src/ax/ai/google-gemini/api.ts`

**Media Handling**:
```typescript
case 'user': {
  const parts: AxAIGoogleGeminiContentPart[] = Array.isArray(msg.content)
    ? msg.content.map((c, i) => {
        switch (c.type) {
          case 'text':
            return { text: c.text };
          case 'image':
            // Direct mimeType and base64 data usage
            return {
              inlineData: { mimeType: c.mimeType, data: c.image },
            };
          default:
            throw new Error(
              `Chat prompt content type not supported (index: ${i})`
            );
        }
      })
    : [{ text: msg.content }];
}
```

**Key Features**:
- **Audio Rejection**: Explicitly throws error for unsupported content types (audio not handled)
- **File Support**: Has `fileData` support via cloud storage URIs (not in AxChatRequest mapping)
- **Inline vs Cloud**: Uses `inlineData` for direct base64, `fileData` for cloud references

### 3. Anthropic Implementation  

**File**: `src/ax/ai/anthropic/api.ts`

**Key Method**: `createMessages()` function

**Media Handling**:
```typescript
case 'user': {
  if (typeof msg.content === 'string') {
    return { role: 'user' as const, content: msg.content };
  }
  const content = msg.content.map((v) => {
    switch (v.type) {
      case 'text':
        return {
          type: 'text' as const,
          text: v.text,
          ...(v.cache ? { cache: { type: 'ephemeral' } } : {}),
        };
      case 'image':
        return {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: v.mimeType,
            data: v.image,
          },
          ...(v.cache ? { cache: { type: 'ephemeral' } } : {}),
        };
      default:
        throw new Error('Invalid content type');
    }
  });
}
```

**Key Features**:
- **Caching Support**: Adds `cache: { type: 'ephemeral' }` when `cache: true` in AxChatRequest
- **Audio/File Rejection**: Throws "Invalid content type" for unsupported media
- **Message Merging**: `mergeAssistantMessages()` consolidates consecutive assistant messages

### 4. Cohere Implementation

**File**: `src/ax/ai/cohere/api.ts`

**Key Method**: `createHistory()` function

**Media Rejection**:
```typescript
if (chat.role === 'system' || chat.role === 'assistant' || chat.role === 'user') {
  if (typeof chat.content === 'string') {
    message = chat.content;
  } else {
    // Explicit rejection of all media content
    throw new Error('Multi-modal content not supported');
  }
}
```

**Key Features**:
- **Complete Media Rejection**: Any non-string content throws "Multi-modal content not supported"
- **Text-Only Processing**: Only handles `message` string fields
- **Tool Results**: Supports function call results but no media in tool outputs

## Implementation Patterns Summary

| Provider | Image Transform | Audio Transform | File Transform | Link Transform | Error Handling |
|----------|----------------|----------------|----------------|---------------|----------------|
| **OpenAI** | base64 → data URL | Direct mapping | N/A in AxChatRequest | N/A | Function continues |
| **Gemini** | base64 → inlineData | Throws error | fileData reference | N/A | Explicit error throw |
| **Anthropic** | base64 → source.data | Throws error | Throws error | N/A | "Invalid content type" |
| **Cohere** | Throws error | Throws error | Throws error | N/A | "Multi-modal content not supported" |

## Response Processing (createChatResp)

### Common Patterns:
1. **Token Usage Extraction**: All providers extract and map token usage to `AxTokenUsage` format
2. **Function Call Mapping**: Convert provider-specific tool call formats to `AxChatResponseResult.functionCalls`
3. **Error Handling**: Map provider errors to `AxAIRefusalError` or other Ax error types
4. **Streaming Support**: Handle both complete responses and streaming deltas

### Media-Specific Response Handling:
- **OpenAI**: Handles media responses in tool outputs and annotations (citations)
- **Gemini**: Processes citations and metadata from search tools
- **Anthropic**: Extracts thinking content and handles content blocks
- **Cohere**: Text-only response processing with tool call results

## Critical Implementation Considerations

### For Developers Using the Ax Framework:

1. **Content Type Validation**: Always validate media content types before sending to providers
   ```typescript
   // Example validation pattern
   if (contentType === 'audio' && provider !== 'openai') {
     throw new Error(`Audio content not supported by ${provider}`);
   }
   ```

2. **Error Handling Strategy**: Different providers throw different errors for unsupported content:
   ```typescript
   try {
     await ai.chat(request);
   } catch (error) {
     if (error.message.includes('Multi-modal content not supported')) {
       // Cohere-specific handling
     } else if (error.message.includes('Chat prompt content type not supported')) {
       // Gemini-specific handling
     }
   }
   ```

3. **Base64 Size Limitations**: Each provider has different limits for base64 content:
   - Monitor payload sizes when including multiple images
   - Consider image compression for large media files

4. **Caching Optimization**: Only Anthropic supports content caching:
   ```typescript
   // Leverage caching for repeated media content with Anthropic
   const request = {
     chatPrompt: [{
       role: 'user',
       content: [{
         type: 'image',
         mimeType: 'image/jpeg',
         image: base64Data,
         cache: true // Only effective with Anthropic
       }]
     }]
   };
   ```

### Provider-Specific Gotchas:

1. **OpenAI**: 
   - Data URL conversion can increase payload size by ~33%
   - Audio format limited to WAV
   - File uploads require separate API endpoints

2. **Google Gemini**:
   - Audio content will cause runtime errors despite type system allowing it
   - File uploads must go through Google Cloud Storage first
   - Search tools require specific configuration

3. **Anthropic**:
   - Content caching only works with `cache: true` flag
   - Message merging can affect conversation context
   - Thinking models have parameter restrictions

4. **Cohere**:
   - Immediate failure on any non-string content
   - No fallback to text extraction from media
   - Function calls limited to text responses

## Recommendations

1. **Multi-modal applications**: OpenAI Chat API or Google Gemini for comprehensive media support
2. **Image-focused workflows**: OpenAI or Anthropic for high-quality image processing
3. **Audio processing**: OpenAI for direct audio input capabilities  
4. **Web search integration**: Google Gemini for built-in URL and search capabilities
5. **Text-only applications**: Cohere for focused conversational AI without media overhead
6. **Caching optimization**: Anthropic for media-heavy workflows requiring cache efficiency
7. **Error resilience**: Implement try-catch around content transformation for graceful media fallbacks
8. **Provider abstraction**: Use feature detection to route requests to appropriate providers based on content type
9. **Content preprocessing**: Implement media-to-text conversion pipelines for providers with limited media support
10. **Monitoring**: Track provider-specific error rates for media content to optimize routing decisions