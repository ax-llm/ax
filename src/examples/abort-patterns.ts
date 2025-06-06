#!/usr/bin/env tsx

/**
 * Comprehensive example demonstrating various abort patterns with AbortController
 * Shows best practices for different use cases
 */

import { AxAI, AxAIServiceAbortedError } from '@ax-llm/ax'

async function basicAbortPattern() {
  console.log('\n🚨 Basic Abort Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Start a request
  const requestPromise = ai.chat(
    {
      chatPrompt: [
        {
          role: 'user',
          content: 'Write a detailed essay about artificial intelligence.',
        },
      ],
    },
    {
      abortSignal: abortController.signal,
    }
  )

  // Simulate user cancellation after 2 seconds
  setTimeout(() => {
    console.log('🛑 User clicked cancel - aborting request...')
    abortController.abort('User cancelled the request')
  }, 2000)

  try {
    const response = await requestPromise
    if (response instanceof ReadableStream) {
      console.log('✅ Stream response received')
    } else {
      console.log(
        '✅ Response received:',
        response.results[0]?.content?.slice(0, 100) + '...'
      )
    }
  } catch (error) {
    if (error instanceof AxAIServiceAbortedError) {
      console.log('❌ Request was aborted:', error.message)
      console.log('📝 Abort reason:', error.context.abortReason)
    } else {
      console.log('❌ Other error:', error)
    }
  }
}

async function timeoutAbortPattern() {
  console.log('\n⏰ Timeout Abort Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Set up automatic timeout
  const timeoutMs = 3000
  const timeoutId = setTimeout(() => {
    console.log(`⏰ Request timed out after ${timeoutMs}ms`)
    abortController.abort(`Request timeout after ${timeoutMs}ms`)
  }, timeoutMs)

  const requestPromise = ai.chat(
    {
      chatPrompt: [
        { role: 'user', content: 'Explain quantum computing in simple terms.' },
      ],
    },
    {
      abortSignal: abortController.signal,
    }
  )

  try {
    const response = await requestPromise
    clearTimeout(timeoutId) // Important: clear timeout on success
    if (response instanceof ReadableStream) {
      console.log('✅ Stream response received within timeout')
    } else {
      console.log(
        '✅ Response received within timeout:',
        response.results[0]?.content?.slice(0, 100) + '...'
      )
    }
  } catch (error) {
    clearTimeout(timeoutId) // Important: always clean up
    if (error instanceof AxAIServiceAbortedError) {
      console.log('❌ Request timed out:', error.message)
    } else {
      console.log('❌ Other error:', error)
    }
  }
}

async function multipleRequestsPattern() {
  console.log('\n🔄 Multiple Requests Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Start multiple related requests
  const requests = [
    ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'What is machine learning?' }],
      },
      { abortSignal: abortController.signal }
    ),

    ai.chat(
      {
        chatPrompt: [{ role: 'user', content: 'What is deep learning?' }],
      },
      { abortSignal: abortController.signal }
    ),

    ai.embed(
      {
        texts: ['Machine learning overview', 'Deep learning concepts'],
      },
      { abortSignal: abortController.signal }
    ),
  ]

  // Abort all requests after 4 seconds
  setTimeout(() => {
    console.log('🛑 Aborting all batch requests...')
    abortController.abort('Batch operation cancelled')
  }, 4000)

  // Handle all requests with Promise.allSettled
  const results = await Promise.allSettled(requests)

  results.forEach((result, index) => {
    const requestType = index < 2 ? 'Chat' : 'Embed'
    if (result.status === 'fulfilled') {
      console.log(`✅ ${requestType} request ${index + 1} completed`)
    } else {
      console.log(
        `❌ ${requestType} request ${index + 1} failed:`,
        result.reason.message
      )
    }
  })
}

async function streamingAbortPattern() {
  console.log('\n🌊 Streaming Abort Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  try {
    const stream = await ai.chat(
      {
        chatPrompt: [
          { role: 'user', content: 'Tell me a story about space exploration.' },
        ],
      },
      {
        stream: true,
        abortSignal: abortController.signal,
      }
    )

    // Abort streaming after 3 seconds
    const timeoutId = setTimeout(() => {
      console.log('🛑 Aborting stream after 3 seconds...')
      abortController.abort('Stream timeout')
    }, 3000)

    if (stream instanceof ReadableStream) {
      const reader = stream.getReader()
      let chunkCount = 0

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          chunkCount++
          const content = value.results[0]?.content || ''
          console.log(`📦 Chunk ${chunkCount}:`, content.slice(0, 50) + '...')
        }
        clearTimeout(timeoutId)
        console.log('✅ Stream completed naturally')
      } catch {
        console.log('❌ Stream was aborted after', chunkCount, 'chunks')
      } finally {
        clearTimeout(timeoutId)
        reader.releaseLock()
      }
    }
  } catch (error) {
    if (error instanceof AxAIServiceAbortedError) {
      console.log('❌ Stream request failed to start:', error.message)
    }
  }
}

async function eventHandlerPattern() {
  console.log('\n📡 Event Handler Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Set up abort event listeners
  abortController.signal.addEventListener('abort', () => {
    console.log('🔔 Abort event fired!')
    console.log('📝 Reason:', abortController.signal.reason)
    console.log('🧹 Cleaning up resources...')
    // Here you would clean up any resources, update UI, etc.
  })

  const requestPromise = ai.chat(
    {
      chatPrompt: [{ role: 'user', content: 'Explain the concept of time.' }],
    },
    {
      abortSignal: abortController.signal,
    }
  )

  // Check if already aborted before starting
  if (abortController.signal.aborted) {
    console.log('❌ Already aborted, not starting request')
    return
  }

  // Trigger abort after 2.5 seconds
  setTimeout(() => {
    abortController.abort('Event handler demo completed')
  }, 2500)

  try {
    const response = await requestPromise
    if (response instanceof ReadableStream) {
      console.log('✅ Stream response received')
    } else {
      console.log(
        '✅ Response received:',
        response.results[0]?.content?.slice(0, 100) + '...'
      )
    }
  } catch (error) {
    if (error instanceof AxAIServiceAbortedError) {
      console.log('❌ Request was aborted through event handler')
    }
  }
}

async function conditionalAbortPattern() {
  console.log('\n🎯 Conditional Abort Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()
  let responseStarted = false

  // Start request
  const requestPromise = ai
    .chat(
      {
        chatPrompt: [
          { role: 'user', content: 'Write a short poem about coding.' },
        ],
      },
      {
        abortSignal: abortController.signal,
      }
    )
    .then((response) => {
      responseStarted = true
      return response
    })

  // Conditional abort logic
  setTimeout(() => {
    if (!responseStarted) {
      console.log('🛑 Request taking too long, aborting...')
      abortController.abort('Conditional timeout - no response started')
    } else {
      console.log('✅ Response already started, letting it complete')
    }
  }, 2000)

  try {
    const response = await requestPromise
    if (response instanceof ReadableStream) {
      console.log('✅ Stream response received')
    } else {
      console.log(
        '✅ Response received:',
        response.results[0]?.content?.slice(0, 100) + '...'
      )
    }
  } catch (error) {
    if (error instanceof AxAIServiceAbortedError) {
      console.log('❌ Request was conditionally aborted:', error.message)
    }
  }
}

// Utility function for racing promises against abort
async function raceWithAbort<T>(
  requestPromise: Promise<T>,
  abortSignal: AbortSignal
): Promise<T> {
  if (abortSignal.aborted) {
    throw new Error(
      `Request aborted: ${abortSignal.reason || 'Unknown reason'}`
    )
  }

  return new Promise<T>((resolve, reject) => {
    const abortHandler = () => {
      reject(
        new Error(`Request aborted: ${abortSignal.reason || 'Unknown reason'}`)
      )
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

async function utilityRacePattern() {
  console.log('\n🏁 Utility Race Pattern')
  console.log('=====================================')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Use the utility function to race against abort
  const requestPromise = ai.chat({
    chatPrompt: [{ role: 'user', content: 'What is the meaning of life?' }],
  })

  // Abort after 2 seconds
  setTimeout(() => {
    console.log('🛑 Racing timeout reached, aborting...')
    abortController.abort('Race timeout')
  }, 2000)

  try {
    const response = await raceWithAbort(requestPromise, abortController.signal)
    if (response instanceof ReadableStream) {
      console.log('✅ Stream response won the race')
    } else {
      console.log(
        '✅ Response won the race:',
        response.results[0]?.content?.slice(0, 100) + '...'
      )
    }
  } catch (error) {
    console.log('❌ Abort won the race:', (error as Error).message)
  }
}

// Main execution
async function main() {
  console.log('🚀 Ax Abort Patterns Demo')
  console.log('Demonstrating various AbortController patterns with Ax')
  console.log('Note: Using demo mode if no OpenAI API key is provided\n')

  try {
    await basicAbortPattern()
    await timeoutAbortPattern()
    await multipleRequestsPattern()
    await streamingAbortPattern()
    await eventHandlerPattern()
    await conditionalAbortPattern()
    await utilityRacePattern()
  } catch (error) {
    console.error('❌ Demo execution failed:', error)
  }

  console.log('\n✅ All abort pattern demos completed!')
  console.log('\n📚 Key takeaways:')
  console.log('• Use AbortController directly for maximum flexibility')
  console.log('• Always clean up timeouts to prevent memory leaks')
  console.log('• Use Promise.allSettled for multiple abortable requests')
  console.log('• Set up abort event listeners for resource cleanup')
  console.log('• Check signal.aborted before starting operations')
  console.log('• Implement custom racing utilities when needed')
}

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  main().catch(console.error)
}
