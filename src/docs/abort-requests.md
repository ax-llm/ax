# Aborting Requests

The Ax framework supports aborting ongoing LLM requests using the standard Web API `AbortController` and `AbortSignal`. This allows users to cancel requests that are taking too long or are no longer needed.

## Basic Usage

### Using AbortSignal

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

## Common Patterns

### Timeout-Based Abortion

```typescript
const ai = new AxAI({
  name: 'openai',
  apiKey: process.env.OPENAI_APIKEY!
})

const abortController = new AbortController()

// Create a timeout that automatically aborts
const timeoutMs = 10000
const timeoutId = setTimeout(() => {
  console.log(`Aborting after ${timeoutMs}ms timeout...`)
  abortController.abort(`Request timeout after ${timeoutMs}ms`)
}, timeoutMs)

const requestPromise = ai.chat({
  chatPrompt: [
    { role: 'user', content: 'Explain quantum computing in detail.' }
  ]
}, {
  abortSignal: abortController.signal
})

try {
  const response = await requestPromise
  clearTimeout(timeoutId) // Clear timeout if request completes
  console.log('Response:', response)
} catch (error) {
  clearTimeout(timeoutId) // Clean up timeout
  if (error instanceof AxAIServiceAbortedError) {
    console.log('Request was aborted:', error.message)
  }
}
```

### Multiple Requests with Shared AbortController

```typescript
const abortController = new AbortController()

// Start multiple requests that share the same abort controller
const requests = [
  ai.chat({
    chatPrompt: [{ role: 'user', content: 'What is machine learning?' }]
  }, { abortSignal: abortController.signal }),
  
  ai.chat({
    chatPrompt: [{ role: 'user', content: 'What is deep learning?' }]
  }, { abortSignal: abortController.signal }),
  
  ai.embed({
    texts: ['Machine learning', 'Deep learning']
  }, { abortSignal: abortController.signal })
]

// Abort all requests after 5 seconds
setTimeout(() => {
  console.log('Aborting all requests...')
  abortController.abort('Batch abort after timeout')
}, 5000)

// Handle all requests
const results = await Promise.allSettled(requests)

results.forEach((result, index) => {
  if (result.status === 'fulfilled') {
    console.log(`✅ Request ${index + 1} completed`)
  } else {
    console.log(`❌ Request ${index + 1} failed:`, result.reason.message)
  }
})
```

### Streaming Requests

Abort works with both regular and streaming requests:

```typescript
const abortController = new AbortController()

try {
  const stream = await ai.chat(
    {
      chatPrompt: [{ role: 'user', content: 'Stream a story.' }]
    },
    { 
      stream: true,
      abortSignal: abortController.signal
    }
  )

  // Abort after 5 seconds
  const timeoutId = setTimeout(() => {
    abortController.abort('Streaming timeout')
  }, 5000)

  if (stream instanceof ReadableStream) {
    const reader = stream.getReader()
    
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        console.log('Chunk:', value.results[0]?.content)
      }
      clearTimeout(timeoutId) // Clear timeout if stream completes
    } catch (streamError) {
      console.log('Stream was aborted')
    } finally {
      clearTimeout(timeoutId) // Always clean up timeout
      reader.releaseLock()
    }
  }
} catch (error) {
  console.log('Request failed to start')
}
```

### Custom Abort Event Handlers

```typescript
const abortController = new AbortController()

// Listen for abort events
abortController.signal.addEventListener('abort', () => {
  console.log('Request aborted:', abortController.signal.reason)
  // Clean up resources, update UI, etc.
})

const requestPromise = ai.chat({
  chatPrompt: [{ role: 'user', content: 'Hello' }]
}, {
  abortSignal: abortController.signal
})

// Abort with custom reason
setTimeout(() => {
  abortController.abort('User cancelled')
}, 3000)
```

## Error Handling

When a request is aborted, an `AxAIServiceAbortedError` is thrown:

```typescript
import { AxAIServiceAbortedError } from '@ax-llm/ax'

try {
  const response = await ai.chat({
    chatPrompt: [{ role: 'user', content: 'Hello' }]
  }, {
    abortSignal: abortController.signal
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
2. **Clean up resources**: Use abort event listeners to clean up any associated resources
3. **Clear timeouts**: Always clear auto-abort timeouts to prevent memory leaks
4. **Use Promise.allSettled**: When handling multiple abortable requests
5. **Graceful degradation**: Provide fallbacks when requests are aborted
6. **Reuse AbortController**: For related requests that should be aborted together
7. **Create new AbortController**: For each independent operation

## Error Types

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

## Utility Patterns

### Racing a Promise Against Abort

```typescript
async function raceWithAbort<T>(
  requestPromise: Promise<T>,
  abortSignal: AbortSignal
): Promise<T> {
  if (abortSignal.aborted) {
    throw new Error(`Request aborted: ${abortSignal.reason || 'Unknown reason'}`)
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = () => {
      reject(new Error(`Request aborted: ${abortSignal.reason || 'Unknown reason'}`))
    }

    abortSignal.addEventListener('abort', abortHandler, { once: true })

    requestPromise
      .then((result) => {
        abortSignal.removeEventListener('abort', abortHandler)
        resolve(result)
      })
      .catch((error) => {
        abortSignal.removeEventListener('abort', abortHandler)
        reject(error)
      })
  })
}

// Usage
const abortController = new AbortController()
const result = await raceWithAbort(
  ai.chat({ chatPrompt: [{ role: 'user', content: 'Hello' }] }),
  abortController.signal
)
``` 