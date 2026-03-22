import { AxPromptTemplate, AxSignature, type AxMessage } from '@ax-llm/ax';

type ImageValue = { mimeType: string; data: string };

const signature = new AxSignature('imageInput:image -> description:string');

const examples = [
  {
    imageInput: { mimeType: 'image/png', data: 'example-image' },
    description: 'A beautiful sunset',
  },
];

const history: ReadonlyArray<AxMessage<{ imageInput: ImageValue }>> = [
  {
    role: 'user',
    values: {
      imageInput: { mimeType: 'image/png', data: 'history-image' },
    },
  },
];

const summarizeContent = (content: unknown) => {
  if (typeof content === 'string') {
    return { kind: 'text', preview: content.slice(0, 80) };
  }

  if (!Array.isArray(content)) {
    return { kind: typeof content };
  }

  return content.map((part) => {
    if (!part || typeof part !== 'object') {
      return { type: typeof part };
    }

    const value = part as {
      type?: string;
      text?: string;
      cache?: boolean;
      mimeType?: string;
      image?: string;
      data?: string;
    };

    return {
      type: value.type,
      cache: value.cache,
      text: value.text?.slice(0, 60),
      mimeType: value.mimeType,
      image: value.image?.slice(0, 20),
      data: value.data?.slice(0, 20),
    };
  });
};

const logPrompt = (
  label: string,
  prompt: ReturnType<AxPromptTemplate['render']>
) => {
  console.log(`\n${label}`);
  console.log(
    JSON.stringify(
      prompt.map((message, index) => ({
        index,
        role: message.role,
        cache: 'cache' in message ? message.cache : undefined,
        content: summarizeContent(
          'content' in message ? message.content : undefined
        ),
      })),
      null,
      2
    )
  );
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const getContent = (
  message: ReturnType<AxPromptTemplate['render']>[number] | undefined
) => {
  if (message && 'content' in message) {
    return message.content;
  }

  return undefined;
};

const hasText = (content: unknown, text: string) =>
  Array.isArray(content) &&
  content.some(
    (part) =>
      !!part &&
      typeof part === 'object' &&
      'type' in part &&
      (part as { type?: string }).type === 'text' &&
      'text' in part &&
      String((part as { text?: string }).text).includes(text)
  );

const hasImage = (content: unknown) =>
  Array.isArray(content) &&
  content.some(
    (part) =>
      !!part &&
      typeof part === 'object' &&
      'type' in part &&
      (part as { type?: string }).type === 'image'
  );

const hasCachedPart = (content: unknown) =>
  Array.isArray(content) &&
  content.some(
    (part) =>
      !!part &&
      typeof part === 'object' &&
      'cache' in part &&
      Boolean((part as { cache?: boolean }).cache)
  );

const cachedTemplate = new AxPromptTemplate(signature, {
  examplesInSystem: true,
  contextCache: { ttlSeconds: 3600 },
});

const singleTurnPrompt = cachedTemplate.render(
  { imageInput: { mimeType: 'image/png', data: 'live-image' } },
  { examples }
);

logPrompt('Single-turn legacy multimodal boundary', singleTurnPrompt);

assert(
  singleTurnPrompt.length === 3,
  'expected system + examples + live input'
);
assert(
  singleTurnPrompt[1]?.role === 'user',
  'expected examples message at index 1'
);
assert(
  singleTurnPrompt[2]?.role === 'user',
  'expected live input message at index 2'
);
assert(
  'cache' in singleTurnPrompt[1] && singleTurnPrompt[1].cache === true,
  'expected cached examples message'
);
assert(
  !('cache' in singleTurnPrompt[2]) || !singleTurnPrompt[2].cache,
  'expected live input message to remain uncached'
);
assert(
  hasText(getContent(singleTurnPrompt[1]), 'Description: A beautiful sunset'),
  'expected example content to stay in its own message'
);
assert(
  hasImage(getContent(singleTurnPrompt[1])),
  'expected example message to contain image content'
);
assert(
  hasImage(getContent(singleTurnPrompt[2])),
  'expected live input message to contain image content'
);
assert(
  !hasCachedPart(getContent(singleTurnPrompt[2])),
  'expected no cached parts to leak into the live input message'
);

const historyPrompt = cachedTemplate.render(history, { examples });

logPrompt('History legacy multimodal boundary', historyPrompt);

assert(
  historyPrompt.length === 3,
  'expected system + examples + first user history turn'
);
assert(
  'cache' in historyPrompt[1] && historyPrompt[1].cache === true,
  'expected cached examples message before history'
);
assert(
  !('cache' in historyPrompt[2]) || !historyPrompt[2].cache,
  'expected first real history turn to remain uncached'
);
assert(
  hasImage(getContent(historyPrompt[2])),
  'expected first real history turn to keep image content'
);

const systemBreakpointTemplate = new AxPromptTemplate(signature, {
  examplesInSystem: true,
  contextCache: { ttlSeconds: 3600, cacheBreakpoint: 'system' },
});

const systemBreakpointPrompt = systemBreakpointTemplate.render(
  { imageInput: { mimeType: 'image/png', data: 'live-image' } },
  { examples }
);

logPrompt(
  'System breakpoint legacy multimodal boundary',
  systemBreakpointPrompt
);

assert(
  systemBreakpointPrompt.length === 3,
  'expected separate example and live input messages even without example caching'
);
assert(
  !('cache' in systemBreakpointPrompt[1]) || !systemBreakpointPrompt[1].cache,
  'expected examples message to remain uncached when cacheBreakpoint=system'
);
assert(
  !('cache' in systemBreakpointPrompt[2]) || !systemBreakpointPrompt[2].cache,
  'expected live input message to remain uncached when cacheBreakpoint=system'
);

console.log('\nAll context-cache boundary checks passed.');
