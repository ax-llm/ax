#!/usr/bin/env tsx

/**
 * Simple example demonstrating request abortion in Ax using AbortController
 */

import { AxAI } from '@ax-llm/ax'

async function basicAbortExample() {
  console.log('\n=== Basic Abort Example ===')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Start a chat request with abort support
  const requestPromise = ai.chat(
    {
      chatPrompt: [
        {
          role: 'user',
          content: 'Tell me a very long story about space exploration.',
        },
      ],
    },
    {
      abortSignal: abortController.signal,
    }
  )

  // Abort after 2 seconds
  setTimeout(() => {
    console.log('Aborting request...')
    abortController.abort('Request took too long')
  }, 2000)

  try {
    const response = await requestPromise
    console.log('Response received:', response)
  } catch (error) {
    console.log('✅ Request was aborted:', (error as Error).message)
  }
}

async function timeoutAbortExample() {
  console.log('\n=== Timeout Abort Example ===')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Create a timeout that automatically aborts
  const timeoutMs = 1500
  const timeoutId = setTimeout(() => {
    console.log(`Aborting after ${timeoutMs}ms timeout...`)
    abortController.abort(`Request timeout after ${timeoutMs}ms`)
  }, timeoutMs)

  // Start a request
  const requestPromise = ai.chat(
    {
      chatPrompt: [
        { role: 'user', content: 'Explain quantum computing in detail.' },
      ],
    },
    {
      abortSignal: abortController.signal,
    }
  )

  try {
    const response = await requestPromise
    clearTimeout(timeoutId) // Clear timeout if request completes
    console.log('Response received:', response)
  } catch (error) {
    clearTimeout(timeoutId) // Clean up timeout
    console.log('✅ Request was aborted:', (error as Error).message)
  }
}

async function embedAbortExample() {
  console.log('\n=== Embed Abort Example ===')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Start an embed request with abort support
  const embedPromise = ai.embed(
    {
      texts: ['This is a text to embed', 'Another text to embed'],
    },
    {
      abortSignal: abortController.signal,
    }
  )

  // Abort after 1 second
  setTimeout(() => {
    console.log('Aborting embed request...')
    abortController.abort('Embed took too long')
  }, 1000)

  try {
    const embedResponse = await embedPromise
    console.log(
      'Embed response received:',
      embedResponse.embeddings.length,
      'embeddings'
    )
  } catch (error) {
    console.log('✅ Embed request was aborted:', (error as Error).message)
  }
}

async function multipleRequestsExample() {
  console.log('\n=== Multiple Requests with Shared AbortController ===')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortController = new AbortController()

  // Start multiple requests that share the same abort controller
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
        texts: ['Machine learning', 'Deep learning'],
      },
      { abortSignal: abortController.signal }
    ),
  ]

  // Abort all requests after 2 seconds
  setTimeout(() => {
    console.log('Aborting all requests...')
    abortController.abort('Batch abort after timeout')
  }, 2000)

  // Handle all requests
  const results = await Promise.allSettled(requests)

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      console.log(`✅ Request ${index + 1} completed`)
    } else {
      console.log(`❌ Request ${index + 1} failed:`, result.reason.message)
    }
  })
}

// Main execution
async function main() {
  console.log('🚀 Ax Request Abortion Examples')
  console.log('Note: These examples use demo mode if no API key is provided')

  try {
    await basicAbortExample()
    await timeoutAbortExample()
    await embedAbortExample()
    await multipleRequestsExample()
  } catch (error) {
    console.error('Example execution failed:', error)
  }

  console.log('\n✅ All abort examples completed!')
  console.log('\nKey patterns demonstrated:')
  console.log('• Use AbortController directly for simple cases')
  console.log('• Combine with setTimeout for timeout-based abortion')
  console.log('• Share AbortController across multiple requests')
  console.log('• Always clean up timeouts to prevent memory leaks')
  console.log(
    '• Use Promise.allSettled for handling multiple abortable requests'
  )
}

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  main().catch(console.error)
}
