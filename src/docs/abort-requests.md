# Aborting Requests

The Ax framework supports aborting ongoing LLM requests using the standard Web API `AbortController` and `AbortSignal`. This allows users to cancel requests that are taking too long or are no longer needed.

## Basic Usage

### Using AbortSignal Directly

```typescript
import { AxAI } from '@ax-llm/ax'

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!
})

const abortController = new AbortController()

// Start a request with abort support
const requestPromise = ai.chat(
  {
    chatPrompt: [
      { role: 'user', content: 'Tell me a very long story.' }
    ]
  },
  {
    abortSignal: abortController.signal
  }
)

// Abort the request after 5 seconds
setTimeout(() => {
  abortController.abort('Request took too long')
}, 5000)

try {
  const response = await requestPromise
  console.log('Response:', response)
} catch (error) {
  if (error instanceof AxAIServiceAbortedError) {
    console.log('Request was aborted:', error.message)
  }
}
```

### Using AxAbortableAI Utility

```typescript
import { AxAI } from '@ax-llm/ax'
import { AxAbortableAI } from '@ax-llm/ax/ai/abortable.js'

const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!
})

const abortableAI = new AxAbortableAI(ai)

// Start a request
const requestPromise = abortableAI.chat({
  chatPrompt: [
    { role: 'user', content: 'Explain quantum computing.' }
  ]
})

// Abort after 3 seconds
setTimeout(() => {
  abortableAI.abort('Taking too long')
}, 3000)

try {
  const response = await requestPromise
} catch (error) {
  console.log('Request aborted')
}
```

## Advanced Features

### Auto-Abort with Timeout

```typescript
import { createAbortableAI } from '@ax-llm/ax/ai/abortable.js'

const abortableAI = createAbortableAI(ai)

const requestPromise = abortableAI.chat({
  chatPrompt: [{ role: 'user', content: 'Write an essay.' }]
})

// Auto-abort after 10 seconds
const timeoutId = abortableAI.abortAfter(10000, 'Auto-timeout')

try {
  const response = await requestPromise
  clearTimeout(timeoutId) // Clear if completed successfully
} catch (error) {
  console.log('Request was auto-aborted')
}
```

### Abort Event Listeners

```typescript
const abortableAI = new AxAbortableAI(ai)

// Listen for abort events
abortableAI.onAbort((reason) => {
  console.log('Request aborted:', reason)
  // Clean up resources, update UI, etc.
})

const requestPromise = abortableAI.chat({
  chatPrompt: [{ role: 'user', content: 'Hello' }]
})

// Abort with custom reason
abortableAI.abort('User cancelled')
```

### Resetting for Multiple Requests

```typescript
const abortableAI = new AxAbortableAI(ai)

// First request
try {
  await abortableAI.chat({ chatPrompt: [{ role: 'user', content: 'Hello' }] })
} catch (error) {
  // Handle first request
}

// Reset for second request
abortableAI.reset()

// Second request with fresh abort controller
try {
  await abortableAI.chat({ chatPrompt: [{ role: 'user', content: 'Goodbye' }] })
} catch (error) {
  // Handle second request
}
```

### Streaming Requests

Abort works with both regular and streaming requests:

```typescript
const abortableAI = new AxAbortableAI(ai)

try {
  const stream = await abortableAI.chat(
    {
      chatPrompt: [{ role: 'user', content: 'Stream a story.' }]
    },
    { stream: true }
  )

  // Abort after 5 seconds
  setTimeout(() => {
    abortableAI.abort('Streaming timeout')
  }, 5000)

  if (stream instanceof ReadableStream) {
    const reader = stream.getReader()
    
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        console.log('Chunk:', value.results[0]?.content)
      }
    } catch (streamError) {
      console.log('Stream was aborted')
    } finally {
      reader.releaseLock()
    }
  }
} catch (error) {
  console.log('Request failed to start')
}
```

## Error Handling

When a request is aborted, an `AxAIServiceAbortedError` is thrown:

```typescript
import { AxAIServiceAbortedError } from '@ax-llm/ax'

try {
  const response = await abortableAI.chat({
    chatPrompt: [{ role: 'user', content: 'Hello' }]
  })
} catch (error) {
  if (error instanceof AxAIServiceAbortedError) {
    console.log('Abort reason:', error.context.abortReason)
    console.log('Request URL:', error.url)
    console.log('Error ID:', error.errorId)
  }
}
```

## Integration with Forward Methods

Abort signals work with DSP forward and streaming forward methods:

```typescript
import { AxGen } from '@ax-llm/ax'

const gen = new AxGen('input -> output')
const abortController = new AbortController()

// Regular forward with abort
const response = await gen.forward(
  ai,
  { input: 'Hello' },
  {
    abortSignal: abortController.signal,
    sessionId: 'my-session',
    debug: true,
    maxRetries: 3,
  }
)

// Streaming forward with abort
const stream = gen.streamingForward(
  ai,
  { input: 'Hello' },
  {
    abortSignal: abortController.signal,
    maxSteps: 5,
  }
)

// Abort after 10 seconds
setTimeout(() => {
  abortController.abort('Forward took too long')
}, 10000)
```

## Integration with Existing Options

Abort signals work alongside all existing AI service options:

```typescript
const response = await ai.chat(
  {
    chatPrompt: [{ role: 'user', content: 'Hello' }]
  },
  {
    abortSignal: abortController.signal,
    sessionId: 'my-session',
    debug: true,
    stream: true,
    timeout: 30000, // This timeout works alongside abort
  }
)

// Embed requests also support abort
const embedResponse = await ai.embed(
  {
    texts: ['Text to embed']
  },
  {
    abortSignal: abortController.signal,
    sessionId: 'my-session',
  }
)
```

## Best Practices

1. **Always handle abort errors**: Check for `AxAIServiceAbortedError` in your error handling
2. **Clean up resources**: Use abort listeners to clean up any associated resources
3. **Reset when reusing**: Call `reset()` on `AxAbortableAI` when making multiple requests
4. **Clear timeouts**: Clear auto-abort timeouts if requests complete successfully
5. **Graceful degradation**: Provide fallbacks when requests are aborted

## API Reference

### AxAbortableAI

- `constructor(ai: AxAIService)` - Wrap an AI service with abort functionality
- `abort(reason?: string)` - Abort the current request
- `reset()` - Reset the abort controller for new requests
- `abortAfter(ms: number, reason?: string)` - Auto-abort after timeout
- `onAbort(callback: (reason?: string) => void)` - Listen for abort events
- `signal: AbortSignal` - Access the current abort signal
- `aborted: boolean` - Check if currently aborted

### Utility Functions

- `createAbortableAI(ai)` - Factory function to create an AxAbortableAI
- `raceWithAbort(promise, signal)` - Race a promise against an abort signal

### Error Types

- `AxAIServiceAbortedError` - Thrown when a request is aborted
- Contains `url`, `requestBody`, `context.abortReason`, and other debugging info

## High-Level Component Support

### AxDBManager

Database operations support abort signals:

```typescript
import { AxDBManager } from '@ax-llm/ax'

const dbManager = new AxDBManager({ ai, db })
const abortController = new AbortController()

// Insert with abort support
await dbManager.insert(
  ['Text 1', 'Text 2'],
  { 
    batchSize: 5,
    abortSignal: abortController.signal 
  }
)

// Query with abort support
const results = await dbManager.query(
  'search query',
  { 
    topPercent: 0.1,
    abortSignal: abortController.signal 
  }
)
```

### AxSimpleClassifier

Classification operations support abort signals:

```typescript
import { AxSimpleClassifier, AxSimpleClassifierClass } from '@ax-llm/ax'

const classifier = new AxSimpleClassifier(ai)
const abortController = new AbortController()

// Set classes with abort support
await classifier.setClasses(
  [
    new AxSimpleClassifierClass('positive', ['good', 'great', 'excellent']),
    new AxSimpleClassifierClass('negative', ['bad', 'terrible', 'awful'])
  ],
  { abortSignal: abortController.signal }
)

// Classify with abort support
const result = await classifier.forward(
  'This is amazing!',
  { 
    cutoff: 0.8,
    abortSignal: abortController.signal 
  }
)
``` 