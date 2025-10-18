# Zod Integration Blueprint for Ax

## Overview
This document proposes a deep, foundational integration of [Zod](https://zod.dev) into Ax so that Zod schemas become first-class citizens throughout the signature, engine, and assertion layers. The design builds upon the groundwork in PR #388 and aims to unlock seamless schema reuse, rich runtime validation, and best-in-class developer ergonomics for AI workflow authoring.

---

## Architecture Proposal
The integration introduces new adapters and validation flows that allow Zod schemas to travel with Ax signatures from definition to runtime enforcement.

### Component Diagram (textual UML)
```
+-----------------+                +--------------------+            +---------------------+
|  Zod Schema     | --(register)--> | AxZodRegistry      | --(build)-> | AxSignatureFactory  |
| (z.object(...)) |                 | (schema cache)     |            | (existing)          |
+-----------------+                +--------------------+            +---------------------+
         |                                      |                                  |
         |                                      v                                  v
         |                            +----------------+                 +--------------------+
         |                            | AxSignature    |<--+             | AxGen / AxFlow      |
         |                            | (with zodMeta) |   |             | (DSPy-style engine) |
         |                            +----------------+   |             +--------------------+
         |                                      |          |                      |
         |                                      v          |                      v
         |                            +----------------+   |             +----------------------+
         |                            | AxAssertion    |<--+--(auto)-----| ZodAssertionAdapter  |
         |                            | Pipeline       |                 | (.parse/.safeParse) |
         |                            +----------------+                 +----------------------+
         |                                      |                                  |
         |                                      v                                  v
         +-----------------------------+  +--------------+           +-------------------------+
                                       | Runtime Output | --LLM-->   | Streaming Validator     |
                                       | (JSON/prose)   |            | (per-field / final)     |
                                       +--------------+-+           +-------------------------+
                                                      |
                                                      v
                                            +-------------------+
                                            | ValidationResult  |
                                            |  - success        |
                                            |  - errors         |
                                            |  - telemetry      |
                                            +-------------------+
```

### Key Modules & APIs
- `AxSignature.fromZod(schema, options?: AxZodSignatureOptions): AxSignature`
  - `options.strict`: throw on any downgrade or unsupported feature.
  - `options.streaming`: enable emission of field-level validators for streaming output enforcement.
  - `options.mode`: `'parse' | 'safeParse' | 'coerce'` to align with Zod parsing semantics.
  - `options.assertionLevel`: `'none' | 'final' | 'streaming' | 'both'` to control auto-assertion wiring.

- `AxSignature.toZod(signature, options?: AxToZodOptions): ZodSchema`
  - Round-trip support with metadata preservation.

- `AxZodRegistry`
  - Internal cache keyed by signature ID to store original Zod schema, downgrade notes, and validation options.
  - Provides `get(schemaId)` for runtime validation modules.

- `ZodAssertionAdapter`
  - Translates Zod `.parse`, `.safeParse`, `.min`, `.max`, `.default`, `.catch`, `.transform`, and `.refine` hooks into Ax assertions.
  - Emits `AxAssertion` objects with `severity`, `recovery` (fallback result), and `telemetry` payloads.

- `StreamingZodValidator`
  - Wraps Zod schema introspection to produce field-level validators suitable for Ax’s streaming extraction pipeline.
  - Supports chunk-level validation and progressive parse with buffering.

- `AxValidationTelemetry`
  - Unified event schema capturing downgrade issues, parse failures, defaults applied, and user-facing remediation tips.

- `AxZodCLI`
  - CLI command (`npx ax zod audit`) to inspect schemas, report downgrades, and generate migration hints.

---

## Implementation Roadmap

### Phase 1 – Schema Fidelity & Runtime Parse (Foundational)
1. **Metadata Extensions**: Augment `AxSignature` to carry `zodMeta` (original schema, version, options) via weak references to avoid bundling heavy schema graphs when unused.
2. **Round-trip APIs**: Harden `AxSignature.fromZod` and add `AxSignature.toZod`, targeting >95% fidelity for primitives, objects, literals, enums, arrays, unions, records, defaults, transforms, `ZodEffects`, and branded schemas.
3. **Assertion Wiring**: Auto-register final-result assertions by default using `.safeParse`. Surface `.error.flatten()` payloads in telemetry.
4. **Downgrade/Validation Telemetry**: Extend existing conversion diagnostics with runtime parse failure logging, `strict` mode enforcement, and actionable guidance.
5. **Deterministic Tests**: Add comprehensive unit tests that cover round-tripping, default application, safe parsing, and error telemetry without external API calls.
6. **Docs & Examples**: Update README, SIGNATURES guide, and create a dedicated `ZOD_INTEGRATION` doc (this file) plus deterministic examples (e.g., using mocked LLM outputs).

### Phase 2 – Streaming Validation & Advanced Semantics
1. **Streaming Validator**: Design `StreamingZodValidator` to map object fields to incremental validators. Support buffering for arrays/objects and fail-fast on impossible states.
2. **Per-field Assertions**: Augment AxGen to attach streaming assertions that fire as tokens arrive, bridging Ax’s internal validator with Zod hints (min/max length, regex, `.nonempty`, etc.).
3. **Fallback Strategies**: Integrate jsonrepair/normalization hooks before final parse; allow `.catch` and `.default` to recover gracefully.
4. **Transforms & Effects**: Provide opt-in handling for `ZodEffects` and `transform` pipelines by running transforms post-parse while tracking original raw output for telemetry.
5. **CLI Enhancements**: Extend `ax zod audit` to simulate streaming validations and suggest signature adjustments.

### Phase 3 – Ecosystem & Extensibility
1. **Factory & Recipes**: Provide helper factories (`createZodSignature(schema, options)`) and recipe docs for migrating from Mastra/Superstruct flows.
2. **Extensibility Hooks**: Formalize plugin interface so alternative schema libraries (Superstruct, Valibot) can plug into the same assertion pipeline.
3. **Performance Tuning**: Benchmark large schemas (>30 fields) under streaming and batch parse; expose profiling telemetry.
4. **DX Enhancements**: VS Code snippets, typed helper utilities, and cross-linked guides (e.g., flow recipes, optimization docs).
5. **Community Feedback Loop**: Add telemetry counters (opt-in) for parse failures and defaults applied; document contribution guidelines for new schema adapters.

---

## Code Snippets

### 1. Converting Zod Schema to Ax Signature with Strict Validation
```ts
import { z } from "zod";
import { AxSignature } from "ax/signature";

const invoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  totalCents: z.number().int().min(0),
  issuedAt: z.string().datetime().default(() => new Date().toISOString()),
});

const signature = AxSignature.fromZod(invoiceSchema, {
  strict: true,
  assertionLevel: "final",
  mode: "safeParse",
});
```

### 2. Using Auto-Applied Zod Assertions in AxGen
```ts
import { axgen } from "ax";
import { z } from "zod";

const schema = z.object({
  customerName: z.string().min(1),
  preferredContact: z.enum(["email", "phone"]).default("email"),
});

const gen = axgen()
  .signature(schema) // equivalent to AxSignature.fromZod(schema)
  .prompt("Collect the customer preferences from the conversation.")
  .onFailure((ctx, error) => {
    ctx.logger.warn("Zod validation failed", { error });
    return ctx.retry();
  });

const result = await gen.run({ transcript });
// result.payload is guaranteed to satisfy schema.parse(...) semantics
```

### 3. Streaming Validation Hook
```ts
import { createStreamingValidator } from "ax/zod/stream";

const validator = createStreamingValidator(schema, { chunkSize: 128 });

for await (const token of llmStream) {
  const status = validator.ingest(token);
  if (status.type === "error") {
    // Apply jsonrepair, request model correction, or abort
    await controller.requestFix(status.issues);
  }
}

const finalValue = validator.finalize();
```

### 4. Round-trip Conversion (AxSignature → Zod)
```ts
const existingSignature = AxSignature.load("customer.profile");
const zodSchema = existingSignature.toZod();

// Apply additional refinements with Zod API
const stricterSchema = zodSchema.extend({
  loyaltyTier: z.enum(["bronze", "silver", "gold"]).catch("bronze"),
});
```

### 5. CLI Audit Example
```bash
npx ax zod audit ./schemas/customer.ts --strict --report json
```

---

## Trade-offs & Risks
- **Performance Overhead**: Zod parsing incurs runtime cost, especially for large schemas. Mitigation: allow opt-in streaming validation to catch errors early, cache compiled schemas, and benchmark to ensure <10% throughput regression for typical flows.
- **Streaming Complexity**: Zod is not inherently streaming-aware. The proposed streaming validator will require custom buffering logic; certain constructs (e.g., regex on entire strings, cross-field refinement) may only be enforceable at finalize-time.
- **Schema Fidelity Gaps**: Features like `ZodFunction`, complex intersections, and advanced `ZodEffects` may still need JSON fallbacks. Document these limitations and provide telemetry to guide users.
- **Version Compatibility**: Supporting both Zod v3 and v4 demands careful dependency and type management. Use adapters and peer dependency ranges; run compatibility tests in CI.
- **Optional Dependency**: Keeping Zod optional reduces bundle size for non-users but requires defensive imports and runtime checks. Provide clear error messages when Zod-specific APIs are invoked without the dependency.

---

## Success Metrics
- **Schema Fidelity**: ≥95% of schemas in the test corpus convert round-trip without downgrade warnings.
- **Runtime Reliability**: ≥90% reduction in manual signature authoring among beta users migrating from Zod-heavy stacks (survey-based).
- **DX Satisfaction**: Positive qualitative feedback (≥4/5) from developer surveys on the new CLI, docs, and auto-assertions.
- **Telemetry Signals**: Monitoring shows decreasing parse failure rates over time due to better defaults and `.catch` handling; streaming validator issues are actionable.
- **Adoption**: At least two reference integrations (e.g., Mastra migration, OpenAI structured extraction recipe) published using the new APIs.

---

## Next Steps
- Circulate this blueprint with maintainers (@dosco, @monotykamary) for feedback.
- Align roadmap milestones with upcoming releases.
- Kick off Phase 1 implementation with focus on metadata extensions and runtime assertions.

