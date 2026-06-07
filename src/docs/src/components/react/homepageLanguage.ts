import { useEffect, useState } from 'react';

export const HOMEPAGE_LANGUAGES = [
  { id: 'typescript', label: 'TypeScript' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'cpp', label: 'C++' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
] as const;

export type HomepageLanguage = (typeof HOMEPAGE_LANGUAGES)[number]['id'];
export type SignatureTab = 'native' | 'string' | 'schema';

type CodePanel = {
  filename: string;
  code: string;
};

type ExamplePanel = CodePanel & {
  output: string;
  status: string;
};

type SignaturePanel = CodePanel & {
  tabLabel: string;
  output: string;
  features: string[];
};

type AgentPanel = CodePanel & {
  runtimeLabel: string;
};

export type HomepageLanguageDemo = {
  label: string;
  command: string;
  classifier: ExamplePanel;
  signatures: Record<SignatureTab, SignaturePanel>;
  agent: AgentPanel;
};

const DEFAULT_LANGUAGE: HomepageLanguage = 'typescript';
const LANGUAGE_EVENT = 'ax:homepage-language';

declare global {
  interface Window {
    __axHomepageLanguage?: HomepageLanguage;
    __axHomepageLanguageTimer?: number;
    __axHomepageLanguageRotationOwner?: number;
  }
}

function isHomepageLanguage(value: unknown): value is HomepageLanguage {
  return (
    typeof value === 'string' &&
    HOMEPAGE_LANGUAGES.some((language) => language.id === value)
  );
}

export function getHomepageLanguage(): HomepageLanguage {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE;
  }
  return window.__axHomepageLanguage ?? DEFAULT_LANGUAGE;
}

export function setHomepageLanguage(language: HomepageLanguage) {
  if (typeof window === 'undefined') {
    return;
  }

  window.__axHomepageLanguage = language;
  window.dispatchEvent(
    new CustomEvent<HomepageLanguage>(LANGUAGE_EVENT, { detail: language })
  );
}

export function stopHomepageLanguageRotation() {
  if (typeof window === 'undefined') {
    return;
  }

  window.__axHomepageLanguageRotationOwner = undefined;

  if (window.__axHomepageLanguageTimer) {
    clearTimeout(window.__axHomepageLanguageTimer);
    window.__axHomepageLanguageTimer = undefined;
  }
}

export function getNextHomepageLanguage(language: HomepageLanguage) {
  const index = HOMEPAGE_LANGUAGES.findIndex((item) => item.id === language);
  return HOMEPAGE_LANGUAGES[(index + 1) % HOMEPAGE_LANGUAGES.length].id;
}

export function useHomepageLanguage() {
  const [language, setLanguage] = useState<HomepageLanguage>(DEFAULT_LANGUAGE);

  useEffect(() => {
    setLanguage(getHomepageLanguage());

    const handleLanguageChange = (event: Event) => {
      const nextLanguage = (event as CustomEvent<unknown>).detail;
      if (isHomepageLanguage(nextLanguage)) {
        setLanguage(nextLanguage);
      }
    };

    window.addEventListener(LANGUAGE_EVENT, handleLanguageChange);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, handleLanguageChange);
    };
  }, []);

  return language;
}

export function getHomepageLanguageDemo(language: HomepageLanguage) {
  return HOMEPAGE_LANGUAGE_DEMOS[language];
}

const classifierOutput = `{
  "sentiment": "positive"
}`;

const typedOutput = `{
  "summary": "Service agreement between...",
  "entities": [
    { "name": "Acme Corp", "type": "org", "confidence": 0.95 },
    { "name": "Jane Smith", "type": "person", "confidence": 0.88 }
  ],
  "tags": ["contract", "legal", "NDA"]
}`;

const stringOutput = `{
  "sentiment": "pos",
  "names": ["Alice", "Bob"],
  "dates": ["2025-03-15"],
  "amounts": [1500, 3200],
  "answer": "42"
}`;

const schemaOutput = `{
  "type": "object",
  "properties": {
    "summary": { "type": "string" },
    "score": { "type": "number" },
    "keyPoints": { "type": "array" }
  },
  "required": ["summary", "score"]
}`;

const typedFeatures = [
  'Nested objects and typed arrays',
  'Schema validation before returning',
  'Auto-retry on validation failure',
];

const stringFeatures = [
  'Concise one-line signatures',
  'Internal fields can hide reasoning',
  'Images, audio, dates built in',
];

const schemaFeatures = [
  'Same semantic schema in every package',
  'Provider prompts and validation share it',
  'Portable across generated runtimes',
];

export const HOMEPAGE_LANGUAGE_DEMOS: Record<
  HomepageLanguage,
  HomepageLanguageDemo
> = {
  typescript: {
    label: 'TypeScript',
    command: 'npm install @ax-llm/ax',
    classifier: {
      filename: 'classify.ts',
      status: 'Type-safe, validated, auto-retried on failure',
      output: classifierOutput,
      code: `import { ax, ai } from '@ax-llm/ax'

const llm = ai({ name: 'openai' })
const classify = ax(
  'review:string -> sentiment:class "positive, negative, neutral"'
)

const result = await classify.forward(llm, {
  review: 'This product is amazing!'
})`,
    },
    signatures: {
      native: {
        tabLabel: 'Native API',
        filename: 'analyze.ts',
        output: typedOutput,
        features: typedFeatures,
        code: `import { f, ax } from '@ax-llm/ax'

const sig = f()
  .input('document', f.string().min(10))
  .output('summary', f.string().max(500))
  .output('entities', f.object({
    name: f.string().min(1),
    type: f.class(['person', 'org', 'place']),
    confidence: f.number().min(0).max(1),
  }).array())
  .output('tags', f.string().array())
  .build()

const result = await ax(sig).forward(llm, { document })`,
      },
      string: {
        tabLabel: 'String Syntax',
        filename: 'signatures.ts',
        output: stringOutput,
        features: stringFeatures,
        code: `import { ax } from '@ax-llm/ax'

const classify = ax(
  'text:string -> sentiment:class "pos, neg, neutral"'
)

const extract = ax(
  'doc:string -> names:string[], dates:date[], amounts:number[]'
)

const solve = ax(
  'problem:string -> reasoning!:string, answer:string'
)

const result = await classify.forward(llm, {
  text: 'Best purchase ever!'
})`,
      },
      schema: {
        tabLabel: 'Zod Schema',
        filename: 'zod-schema.ts',
        output: schemaOutput,
        features: schemaFeatures,
        code: `import { z } from 'zod'
import { f, ax } from '@ax-llm/ax'

const sig = f()
  .input(z.object({
    document: z.string().min(10)
  }))
  .output(z.object({
    summary: z.string(),
    score: z.number().min(1).max(10),
    keyPoints: z.array(z.string()),
  }))
  .build()

const result = await ax(sig).forward(llm, { document })`,
      },
    },
    agent: {
      filename: 'researcher.ts',
      runtimeLabel: 'JS runtime session',
      code: `import { agent, AxJSRuntime } from '@ax-llm/ax'

const researcher = agent(
  'topic:string, largeDocument:string -> report:string',
  {
    runtime: new AxJSRuntime(),
    contextFields: ['largeDocument'],
    functions: [search, scrape],
  }
)

const { report } = await researcher.forward(ai, {
  topic: '...',
  largeDocument: doc,
})`,
    },
  },
  python: {
    label: 'Python',
    command: 'cd packages/python && python -m pip install -e .',
    classifier: {
      filename: 'classify.py',
      status: 'Validated Python dicts from the same Ax signature',
      output: classifierOutput,
      code: `from axllm import ai, ax

llm = ai("openai")
classify = ax(
    'review:string -> sentiment:class "positive, negative, neutral"'
)

result = classify.forward(llm, {
    "review": "This product is amazing!"
})`,
    },
    signatures: {
      native: {
        tabLabel: 'Native API',
        filename: 'analyze.py',
        output: typedOutput,
        features: typedFeatures,
        code: `from axllm import ax

analyze = ax(
    "document:string -> "
    "summary:string, "
    "entities:json[], "
    "tags:string[]"
)

result = analyze.forward(llm, {
    "document": contract_text
})`,
      },
      string: {
        tabLabel: 'String Syntax',
        filename: 'signatures.py',
        output: stringOutput,
        features: stringFeatures,
        code: `from axllm import ax

classify = ax(
    'text:string -> sentiment:class "pos, neg, neutral"'
)
extract = ax(
    "doc:string -> names:string[], dates:date[], amounts:number[]"
)
solve = ax(
    "problem:string -> reasoning!:string, answer:string"
)

result = classify.forward(llm, {"text": "Best purchase ever!"})`,
      },
      schema: {
        tabLabel: 'Schema Shape',
        filename: 'schema.py',
        output: schemaOutput,
        features: schemaFeatures,
        code: `from axllm import s

sig = s(
    "document:string -> "
    "summary:string, score:number, keyPoints:string[]"
)

schema = sig.to_json_schema("outputs")
assert "summary" in schema["properties"]`,
      },
    },
    agent: {
      filename: 'researcher.py',
      runtimeLabel: 'Python host session',
      code: `from axllm import agent

researcher = agent(
    "topic:string, largeDocument:string -> report:string",
    {
        "contextFields": ["largeDocument"],
        "functions": [search, scrape],
    },
)

out = researcher.forward(client, {
    "topic": "...",
    "largeDocument": doc,
})`,
    },
  },
  java: {
    label: 'Java',
    command: 'cd packages/java && ./gradlew test',
    classifier: {
      filename: 'Classify.java',
      status: 'Java maps in, validated Ax fields out',
      output: classifierOutput,
      code: `import dev.axllm.ax.*;
import java.util.*;

var llm = Ax.ai("openai", Map.of());
var classify = Ax.ax(
  "review:string -> sentiment:class \\"positive, negative, neutral\\""
);

var result = classify.forward(llm, Map.of(
  "review", "This product is amazing!"
));`,
    },
    signatures: {
      native: {
        tabLabel: 'Native API',
        filename: 'Analyze.java',
        output: typedOutput,
        features: typedFeatures,
        code: `import dev.axllm.ax.*;
import java.util.*;

var analyze = Ax.ax(
  "document:string -> summary:string, entities:json[], tags:string[]"
);

Map<String, Object> result = analyze.forward(
  llm,
  Map.of("document", contractText)
);`,
      },
      string: {
        tabLabel: 'String Syntax',
        filename: 'Signatures.java',
        output: stringOutput,
        features: stringFeatures,
        code: `var classify = Ax.ax(
  "text:string -> sentiment:class \\"pos, neg, neutral\\""
);
var extract = Ax.ax(
  "doc:string -> names:string[], dates:date[], amounts:number[]"
);
var solve = Ax.ax(
  "problem:string -> reasoning!:string, answer:string"
);

var result = classify.forward(llm, Map.of(
  "text", "Best purchase ever!"
));`,
      },
      schema: {
        tabLabel: 'Schema Shape',
        filename: 'Schema.java',
        output: schemaOutput,
        features: schemaFeatures,
        code: `AxSignature sig = Ax.s(
  "document:string -> summary:string, score:number, keyPoints:string[]"
);

Map<String, Object> schema = sig.toJSONSchema("outputs");
if (!schema.containsKey("properties")) {
  throw new IllegalStateException("bad schema");
}`,
      },
    },
    agent: {
      filename: 'Researcher.java',
      runtimeLabel: 'JVM host session',
      code: `import dev.axllm.ax.*;
import java.util.*;

var researcher = Ax.agent(
  "topic:string, largeDocument:string -> report:string",
  Map.of(
    "contextFields", List.of("largeDocument"),
    "functions", List.of(search, scrape)
  )
);

var out = researcher.forward(client, Map.of(
  "topic", "...",
  "largeDocument", doc
));`,
    },
  },
  cpp: {
    label: 'C++',
    command: 'cd packages/cpp && cmake -S . -B build',
    classifier: {
      filename: 'classify.cpp',
      status: 'Native values, shared validation semantics',
      output: classifierOutput,
      code: `#include "axllm/axllm.hpp"

auto llm = axllm::ai("openai");
auto classify = axllm::ax(
  "review:string -> sentiment:class \\"positive, negative, neutral\\""
);

auto result = classify.forward(*llm, axllm::object({
  {"review", "This product is amazing!"}
}));`,
    },
    signatures: {
      native: {
        tabLabel: 'Native API',
        filename: 'analyze.cpp',
        output: typedOutput,
        features: typedFeatures,
        code: `#include "axllm/axllm.hpp"

auto analyze = axllm::ax(
  "document:string -> summary:string, entities:json[], tags:string[]"
);

auto result = analyze.forward(*llm, axllm::object({
  {"document", contract_text}
}));`,
      },
      string: {
        tabLabel: 'String Syntax',
        filename: 'signatures.cpp',
        output: stringOutput,
        features: stringFeatures,
        code: `auto classify = axllm::ax(
  "text:string -> sentiment:class \\"pos, neg, neutral\\""
);
auto extract = axllm::ax(
  "doc:string -> names:string[], dates:date[], amounts:number[]"
);
auto solve = axllm::ax(
  "problem:string -> reasoning!:string, answer:string"
);

auto result = classify.forward(*llm, axllm::object({
  {"text", "Best purchase ever!"}
}));`,
      },
      schema: {
        tabLabel: 'Schema Shape',
        filename: 'schema.cpp',
        output: schemaOutput,
        features: schemaFeatures,
        code: `auto sig = axllm::s(
  "document:string -> summary:string, score:number, keyPoints:string[]"
);

auto schema = sig.to_json_schema("outputs");
if (!axllm::Core::truthy(
  axllm::Core::map_contains(schema["properties"], "summary")
)) return 1;`,
      },
    },
    agent: {
      filename: 'researcher.cpp',
      runtimeLabel: 'C++ host session',
      code: `#include "axllm/axllm.hpp"

auto researcher = axllm::agent(
  "topic:string, largeDocument:string -> report:string",
  axllm::object({
    {"contextFields", axllm::array({"largeDocument"})},
    {"functions", axllm::array({search, scrape})}
  })
);

auto out = researcher.forward(client, axllm::object({
  {"topic", "..."},
  {"largeDocument", doc}
}));`,
    },
  },
  go: {
    label: 'Go',
    command: 'cd packages/go && go test ./...',
    classifier: {
      filename: 'classify.go',
      status: 'Go values through the same provider boundary',
      output: classifierOutput,
      code: `import ax "github.com/ax-llm/ax/go"

llm := ax.NewAI("openai", nil)
classify := ax.NewAx(
  "review:string -> sentiment:class \\"positive, negative, neutral\\"",
  nil,
)

result, err := classify.Forward(ctx, llm, map[string]ax.Value{
  "review": "This product is amazing!",
}, nil)`,
    },
    signatures: {
      native: {
        tabLabel: 'Native API',
        filename: 'analyze.go',
        output: typedOutput,
        features: typedFeatures,
        code: `import ax "github.com/ax-llm/ax/go"

analyze := ax.NewAx(
  "document:string -> summary:string, entities:json[], tags:string[]",
  nil,
)

result, err := analyze.Forward(ctx, llm, map[string]ax.Value{
  "document": contractText,
}, nil)`,
      },
      string: {
        tabLabel: 'String Syntax',
        filename: 'signatures.go',
        output: stringOutput,
        features: stringFeatures,
        code: `classify := ax.NewAx(
  "text:string -> sentiment:class \\"pos, neg, neutral\\"", nil,
)
extract := ax.NewAx(
  "doc:string -> names:string[], dates:date[], amounts:number[]", nil,
)
solve := ax.NewAx(
  "problem:string -> reasoning!:string, answer:string", nil,
)

result, err := classify.Forward(ctx, llm, map[string]ax.Value{
  "text": "Best purchase ever!",
}, nil)`,
      },
      schema: {
        tabLabel: 'Schema Shape',
        filename: 'schema.go',
        output: schemaOutput,
        features: schemaFeatures,
        code: `sig := ax.NewSignature(
  "document:string -> summary:string, score:number, keyPoints:string[]",
)

schema := sig.ToJSONSchema("outputs")
if schema["properties"] == nil {
  panic("bad schema")
}`,
      },
    },
    agent: {
      filename: 'researcher.go',
      runtimeLabel: 'Go host session',
      code: `import ax "github.com/ax-llm/ax/go"

researcher := ax.NewAgent(
  "topic:string, largeDocument:string -> report:string",
  map[string]ax.Value{
    "contextFields": ax.Array("largeDocument"),
    "functions": ax.Array(search, scrape),
  },
)

out, err := researcher.Forward(ctx, client, map[string]ax.Value{
  "topic": "...",
  "largeDocument": doc,
}, nil)`,
    },
  },
  rust: {
    label: 'Rust',
    command: 'cd packages/rust && cargo test --all-targets',
    classifier: {
      filename: 'classify.rs',
      status: 'Result-based errors, serde_json at Ax boundaries',
      output: classifierOutput,
      code: `use axllm::{ai, ax, AxResult};
use serde_json::json;

let mut llm = ai("openai", json!({}))?;
let mut classify = ax(
  "review:string -> sentiment:class \\"positive, negative, neutral\\""
)?;

let result = classify.forward(&mut llm, json!({
  "review": "This product is amazing!"
}))?;`,
    },
    signatures: {
      native: {
        tabLabel: 'Native API',
        filename: 'analyze.rs',
        output: typedOutput,
        features: typedFeatures,
        code: `use axllm::{ax, AxResult};
use serde_json::json;

let mut analyze = ax(
  "document:string -> summary:string, entities:json[], tags:string[]"
)?;

let result = analyze.forward(&mut llm, json!({
  "document": contract_text
}))?;`,
      },
      string: {
        tabLabel: 'String Syntax',
        filename: 'signatures.rs',
        output: stringOutput,
        features: stringFeatures,
        code: `let mut classify = ax(
  "text:string -> sentiment:class \\"pos, neg, neutral\\""
)?;
let mut extract = ax(
  "doc:string -> names:string[], dates:date[], amounts:number[]"
)?;
let mut solve = ax(
  "problem:string -> reasoning!:string, answer:string"
)?;

let result = classify.forward(&mut llm, json!({
  "text": "Best purchase ever!"
}))?;`,
      },
      schema: {
        tabLabel: 'Schema Shape',
        filename: 'schema.rs',
        output: schemaOutput,
        features: schemaFeatures,
        code: `use axllm::{s, AxResult};

let sig = s(
  "document:string -> summary:string, score:number, keyPoints:string[]"
)?;

let schema = sig.to_json_schema("outputs");
assert!(schema["properties"].get("summary").is_some());`,
      },
    },
    agent: {
      filename: 'researcher.rs',
      runtimeLabel: 'Rust host session',
      code: `use axllm::{agent, AxResult};
use serde_json::json;

let mut researcher = agent(
  "topic:string, largeDocument:string -> report:string"
)?;

let out = researcher.forward(&mut client, json!({
  "topic": "...",
  "largeDocument": doc
}))?;`,
    },
  },
};

export function providerSnippet(provider: string, language: HomepageLanguage) {
  const id = provider === 'aws-bedrock' ? 'aws-bedrock' : provider;

  switch (language) {
    case 'typescript':
      return id === 'aws-bedrock'
        ? `new AxAIBedrock({ region: 'us-east-2' })`
        : `ai({ name: '${id}' })`;
    case 'python':
      return `ai("${id}")`;
    case 'java':
      return `Ax.ai("${id}", Map.of())`;
    case 'cpp':
      return `axllm::ai("${id}")`;
    case 'go':
      return `ax.NewAI("${id}", nil)`;
    case 'rust':
      return `ai("${id}", json!({}))?`;
  }
}

export function wrapSignature(signature: string, language: HomepageLanguage) {
  const singleQuoted = signature.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const doubleQuoted = signature.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  switch (language) {
    case 'typescript':
      return `ax('${singleQuoted}')`;
    case 'python':
      return `ax('${singleQuoted}')`;
    case 'java':
      return `Ax.ax("${doubleQuoted}")`;
    case 'cpp':
      return `axllm::ax("${doubleQuoted}")`;
    case 'go':
      return `ax.NewAx("${doubleQuoted}", nil)`;
    case 'rust':
      return `ax("${doubleQuoted}")?`;
  }
}
