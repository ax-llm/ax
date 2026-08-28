# Named AI Deployment Profiles

Ax selects deployment behavior with the `name` passed to `ai()`. The model ID is
data inside that deployment; it does not select another provider's request
rules.

```ts
import { ai } from '@ax-llm/ax';

const together = ai({
  name: 'together',
  apiKey: process.env.TOGETHER_API_KEY!,
  config: { model: 'deepseek-ai/DeepSeek-V4-Pro' },
});
```

This request uses Together's endpoint, authentication, reasoning-effort
mapping, and response fields. It does not use DeepSeek's native `thinking`
request object merely because the model ID contains `DeepSeek`.

Reasoning replay is profile-owned too. Together replays its `reasoning` field,
Fireworks replays `reasoning_content`, and OpenRouter can replay both plaintext
`reasoning` and structured `reasoning_details`; Ax does not translate these by
sniffing the model name.

## Discovery

Use `axAIProfiles()` to build selectors or inspect the complete catalog, and
`axGetAIProfile(id)` to inspect one profile. The returned summary includes the
transport, endpoint requirements, authentication, operations, default
capabilities, deployment-scoped model rules, official sources, and review date.

```ts
import { axAIProfiles, axGetAIProfile } from '@ax-llm/ax';

const available = axAIProfiles();
const fireworks = axGetAIProfile('fireworks');
```

See the generated [deployment profile matrix](./AI_PROFILES_MATRIX.md) for all
profiles and their official source links.

## OpenAI And OpenAI-Compatible Endpoints

`openai` means the official OpenAI Chat Completions deployment and carries
OpenAI's verified behavior. `openai-compatible` is the conservative profile for
a custom endpoint:

```ts
const custom = ai({
  name: 'openai-compatible',
  apiURL: 'https://gateway.example/v1',
  apiKey: process.env.GATEWAY_API_KEY,
  config: { model: 'organization/model-id' },
});
```

Unknown profile names fail with the known profile IDs instead of silently
falling back to the compatibility profile.

## Capability Resolution

Capabilities resolve in this order:

1. caller `modelInfo` override;
2. exact model rule in the selected profile;
3. profile-scoped prefix or substring rule;
4. profile default;
5. conservative transport default.

Ax never sniffs endpoint URLs or applies another profile's rules. Explicitly
requesting thinking or structured output for an unverified profile/model fails
before the request. A profile may demote Ax's synthetic `__axOutput` forced tool
choice when the deployment supports tools but not `tool_choice`; a caller's
explicitly forced tool choice fails instead of being silently changed.

## Structured-Output Modes

`AxStructuredOutputRung` is `native | function | json_object`, and
`AxStructuredOutputMode` adds `auto`. Profiles and model rules advertise an
ordered `structuredOutputModes` list. `auto` uses that order, except that a
required singleton string or code field can take the optimized `json_object`
path when native schema is unavailable. An explicit mode must be advertised or
Ax fails before network I/O. Custom clients that do not expose the new list keep
the legacy capability heuristic.

`structuredOutputs` remains the compatibility alias for native JSON Schema
support. It does not imply `json_object`: direct `json_schema` and
`json_object` chat requests validate those capabilities independently.

Vertex rules are deliberately model-scoped. Documented Gemini MaaS IDs prefer
`native`, then `function`, then `json_object`. The exact
`google/gemma-4-26b-a4b-it-maas` rule prefers `json_object`, supports
`function`, and excludes native schema. Unknown Vertex models remain at the
conservative profile default.

## Renewable Credentials

Use `credentialProvider` when a deployment token can expire. Ax calls it for
each request attempt with `{ profile, operation, method, url }`; its returned
headers override static authentication headers. The callback covers chat,
streaming, embeddings, Responses, transcription, speech, and retries. Callback
errors stop before transport. Ax does not automatically replay a completed 401
or 403 because generation requests are not assumed idempotent.

```ts
const vertex = ai({
  name: 'vertex-ai',
  apiURL: process.env.VERTEX_AI_API_URL!,
  config: { model: 'google/gemma-4-26b-a4b-it-maas' },
  credentialProvider: async ({ operation, url }) => ({
    Authorization: `Bearer ${await accessTokens.getFreshToken({ operation, url })}`,
  }),
});
```

Authentication-required profiles accept either `apiKey` or a credential
provider. Keep cloud SDK and ADC dependencies in the host application; the
provider callback is the dependency-free Ax boundary.

Thinking defaults are deployment- and model-scoped request rules. Omitting
`thinkingTokenBudget` selects Ax's logical `max` level for verified reasoning
models and maps it to the strongest effort documented by that deployment:

| Profile | Verified model rule | Logical `max` wire value | Explicit `none` |
|---|---|---|---|
| `deepseek`, `together`, `fireworks`, `openrouter` | Deployment-specific DeepSeek rules | Deployment-specific | Supported only where documented |
| `grok` | Grok 4.6 / 4.5 / 4.3 | `xhigh` / `high` / `high` | Rejected for 4.6 and 4.5 |
| `groq` | GPT-OSS 20B/120B; Qwen 3.6 27B | `high`; `default` (reasoning enabled) | Rejected for GPT-OSS; supported for Qwen |
| `cerebras` | GPT-OSS 120B; Gemma 4 31B | `high` | Rejected for GPT-OSS; supported for Gemma |
| `deepinfra` | DeepSeek R1 family | `high` | Supported |

The native `google-gemini` profile and its `gemini` / `google_gemini` aliases
resolve the effective model before mapping an explicit logical budget. Gemini 3
uses model-supported `thinkingLevel` values, while Gemini 2.5 uses numeric
`thinkingBudget`; `none` always hides thoughts and clamps to the model's minimum
when thinking cannot be disabled. The OpenAI-compatible `vertex-ai` profile
does not inherit this native request shape from Gemini-looking model IDs.

An explicitly unsupported level fails before the request. Hugging Face Router
stays conservative because its `:fastest`, `:cheapest`, and `:preferred`
policies can choose different underlying providers for the same model ID; use
an exact caller `modelInfo` override only after verifying the selected route.
No model inherits behavior merely because its ID resembles another provider's
model.

## Major-Version Migration

Profile-only provider classes were removed. Keep model enum/catalog imports if
they are useful, but construct the deployment through `ai()`:

| Removed construction | Replacement |
|---|---|
| `new AxAIAzureOpenAI(args)` | `ai({ name: 'azure-openai', ...args })` |
| `new AxAICohere(args)` | `ai({ name: 'cohere', ...args })` |
| `new AxAIDeepSeek(args)` | `ai({ name: 'deepseek', ...args })` |
| `new AxAIDeepSeekResponses(args)` | `ai({ name: 'deepseek-responses', ...args })` |
| `new AxAIMistral(args)` | `ai({ name: 'mistral', ...args })` |
| `new AxAIReka(args)` | `ai({ name: 'reka', ...args })` |
| `new AxAIGrok(args)` | `ai({ name: 'grok', ...args })` |

The genuine transport/runtime classes remain: OpenAI-compatible Chat
Completions, OpenAI Responses, Anthropic Messages, Gemini GenerateContent, and
WebLLM. Generated Go, Python, Rust, Java, and C++ packages follow the same
boundary: their named factories resolve a profile and construct a retained
transport client; branded client constructors no longer exist.

### GraphJin Vertex migration

Remove the request-rewriting `responseFormatClient`. Select Vertex explicitly,
let the profile resolve the model's output modes, and refresh credentials at the
request boundary:

```go
client := ax.NewAI("vertex-ai", map[string]ax.Value{
    "api_url": vertexOpenAIURL,
    "model": "google/gemma-4-26b-a4b-it-maas",
    "credential_provider": ax.AxCredentialProviderFunc(
        func(ctx context.Context, request ax.AxCredentialRequest) (map[string]string, error) {
            token, err := vertexAccessToken(ctx) // host-owned ADC or token source
            if err != nil { return nil, err }
            return map[string]string{"Authorization": "Bearer " + token}, nil
        },
    ),
})
```

Ax's Gemma rule sends `response_format: {type: "json_object"}`, defaults
thinking to `max`, writes `chat_template_kwargs.enable_thinking: true`, and
extracts/replays `reasoning_content`. AxGen already supplies the exact-shape
prompt and client-side validation, so do not append a second schema prompt. To
make the rich-output choice explicit, pass
`structured_output_mode: "json_object"` in the generated Go forward options.
This mapping is scoped from the
[GraphJin compatibility workaround](https://github.com/dosco/graphjin/commit/e8a6e1a5fd59242eb406c7062c21a90da8e15353),
Google's official [structured-output](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/structured-output)
and [thinking](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/maas/capabilities/thinking)
documentation, and the official [Vertex OpenAI-compatible endpoint guide](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/call-vertex-using-openai-library).

## Maintaining The Catalog

`ir/axcore/data/provider-profiles.json` is the source of truth. Run:

```bash
npm run profiles:generate
npm run axir:conformance:write
npm run axir:generate-packages
```

The first command validates IDs, aliases, transports, operation dialects,
endpoint/auth requirements, model-rule precedence, and source metadata, then
regenerates the TypeScript registry, AxIR registry/descriptors, and profile
matrix. Live credentialed provider smoke tests are opt-in and are not mandatory
CI.
