#!/usr/bin/env tsx

/**
 * Simple example demonstrating request abortion in Ax
 */

import { AxAI } from '@ax-llm/ax'
import { AxAbortableAI } from '@ax-llm/ax/ai/abortable.js'

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

async function abortableAIExample() {
  console.log('\n=== AxAbortableAI Example ===')

  const ai = new AxAI({
    name: 'openai',
    apiKey: process.env.OPENAI_APIKEY || 'demo',
  })

  const abortableAI = new AxAbortableAI(ai)

  // Start a request
  const requestPromise = abortableAI.chat({
    chatPrompt: [
      { role: 'user', content: 'Explain quantum computing in detail.' },
    ],
  })

  // Abort after 1.5 seconds
  setTimeout(() => {
    console.log('Aborting with AxAbortableAI...')
    abortableAI.abort('Taking too long')
  }, 1500)

  try {
    const response = await requestPromise
    console.log('Response received:', response)
  } catch {
    console.log('✅ Request was aborted via AxAbortableAI')
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

// Main execution
async function main() {
  console.log('🚀 Ax Request Abortion Examples')
  console.log('Note: These examples use demo mode if no API key is provided')

  try {
    await basicAbortExample()
    await abortableAIExample()
    await embedAbortExample()
  } catch (error) {
    console.error('Example execution failed:', error)
  }

  console.log('\n✅ All abort examples completed!')
}

if (import.meta.url.endsWith(process.argv[1] ?? '')) {
  main().catch(console.error)
}
