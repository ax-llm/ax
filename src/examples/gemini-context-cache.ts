/**
 * Gemini Explicit Context Caching Example
 *
 * This example demonstrates how to use Gemini's explicit context caching
 * for long-running multi-turn agentic flows where AxGen is called repeatedly.
 *
 * Usage: Simply pass `contextCache: {}` to enable caching. The system
 * automatically handles cache creation, reuse, and TTL refresh.
 *
 * Benefits:
 * - Predictable cost savings (90% discount on cached tokens for Gemini 2.5)
 * - Lower latency for repeated requests with shared context
 * - Cache persists across multiple AxGen calls within a session
 * - Automatic TTL refresh keeps cache alive during long flows
 *
 * Supported models:
 * - Gemini 3 Flash/Pro (preview)
 * - Gemini 2.5 Pro/Flash/Flash-Lite
 * - Gemini 2.0 Flash/Flash-Lite
 *
 * Note: The same contextCache option works with Anthropic models too,
 * automatically injecting cache_control for ephemeral caching.
 */

import {
  AxAIGoogleGemini,
  AxAIGoogleGeminiModel,
  AxGen,
  AxMemory,
} from '@ax-llm/ax';

// Large system prompt that benefits from caching
const LARGE_SYSTEM_PROMPT = `
You are an expert code reviewer and software architect with deep knowledge of:

1. Software Design Patterns
   - Creational patterns (Singleton, Factory, Builder, Prototype)
   - Structural patterns (Adapter, Bridge, Composite, Decorator, Facade)
   - Behavioral patterns (Observer, Strategy, Command, State, Template Method)

2. Clean Code Principles
   - SOLID principles
   - DRY (Don't Repeat Yourself)
   - KISS (Keep It Simple, Stupid)
   - YAGNI (You Aren't Gonna Need It)

3. Programming Languages
   - TypeScript/JavaScript: Modern ES features, async/await, modules
   - Python: Type hints, dataclasses, async programming
   - Rust: Ownership, borrowing, lifetimes, traits
   - Go: Goroutines, channels, interfaces

4. Architecture Patterns
   - Microservices architecture
   - Event-driven architecture
   - CQRS and Event Sourcing
   - Domain-Driven Design

5. Testing Strategies
   - Unit testing best practices
   - Integration testing patterns
   - Test-driven development (TDD)
   - Behavior-driven development (BDD)

6. Performance Optimization
   - Algorithmic complexity analysis
   - Memory optimization techniques
   - Caching strategies
   - Database query optimization

When reviewing code:
- Focus on maintainability and readability first
- Suggest concrete improvements with examples
- Explain the reasoning behind each suggestion
- Consider edge cases and error handling
- Look for potential security vulnerabilities

Your responses should be structured, clear, and actionable.
`.repeat(5); // Repeat to ensure we exceed 2048 token minimum

async function runWithContextCache() {
  // Initialize Gemini with your API key
  const ai = new AxAIGoogleGemini({
    apiKey: process.env.GOOGLE_APIKEY,
    config: {
      model: AxAIGoogleGeminiModel.Gemini25Flash,
    },
  });

  // Create a shared memory for the session
  const mem = new AxMemory();
  const sessionId = `code-review-${Date.now()}`;

  // Create a code review generator with a large system prompt
  const codeReviewer = new AxGen<
    { code: string; language: string },
    { review: string; suggestions: string[] }
  >(
    `code:string "the code to review", language:string "programming language" -> review:string "detailed code review", suggestions:string[] "list of improvement suggestions"`,
    {
      description: LARGE_SYSTEM_PROMPT,
    }
  );

  console.log('Starting code review session with context caching...\n');

  // Simulate a multi-turn code review session
  const codeSnippets = [
    {
      language: 'typescript',
      code: `
function fetchUser(id: string) {
  return fetch('/api/users/' + id)
    .then(r => r.json());
}`,
    },
    {
      language: 'python',
      code: `
def process_data(items):
    result = []
    for item in items:
        if item > 0:
            result.append(item * 2)
    return result`,
    },
    {
      language: 'typescript',
      code: `
class UserService {
  private cache = new Map();
  
  async getUser(id) {
    if (this.cache.has(id)) {
      return this.cache.get(id);
    }
    const user = await fetch('/api/users/' + id).then(r => r.json());
    this.cache.set(id, user);
    return user;
  }
}`,
    },
  ];

  for (let i = 0; i < codeSnippets.length; i++) {
    const snippet = codeSnippets[i];
    console.log(`\n--- Review ${i + 1}: ${snippet.language} code ---\n`);

    const startTime = Date.now();

    const result = await codeReviewer.forward(ai, snippet, {
      mem,
      sessionId,
      // Enable context caching - presence of this object enables caching
      contextCache: {
        ttlSeconds: 3600, // 1 hour TTL
      },
    });

    const elapsed = Date.now() - startTime;

    console.log(`Review (${elapsed}ms):`);
    console.log(result.review);
    console.log('\nSuggestions:');
    result.suggestions.forEach((s, idx) => console.log(`  ${idx + 1}. ${s}`));

    // On subsequent calls, the cached system prompt should provide faster responses
    if (i > 0) {
      console.log(
        '\n(Cache should be reused - check usage metadata for cacheReadTokens)'
      );
    }
  }

  console.log('\n--- Session complete ---');
  console.log(
    'The system prompt was cached after the first call and reused for subsequent calls.'
  );
  console.log(
    'Check the modelUsage.tokens.cacheReadTokens field in debug logs for cache hits.'
  );
}

// Alternative: Using explicit cache management
async function runWithExplicitCacheManagement() {
  const ai = new AxAIGoogleGemini({
    apiKey: process.env.GOOGLE_APIKEY,
    config: {
      model: AxAIGoogleGeminiModel.Gemini25Flash,
    },
  });

  const sessionId = 'explicit-cache-demo';

  // Create generator with a large system prompt
  const gen = new AxGen<{ question: string }, { answer: string }>(
    'question -> answer',
    {
      description: `${LARGE_SYSTEM_PROMPT}\nAnswer questions concisely and accurately.`,
    }
  );

  // First call: Creates the cache automatically
  console.log('First call - cache will be created automatically...');
  const result1 = await gen.forward(
    ai,
    { question: 'What is the SOLID principle?' },
    {
      sessionId,
      contextCache: {
        ttlSeconds: 7200, // 2 hours TTL
      },
    }
  );
  console.log('Answer:', result1.answer);

  // Subsequent calls: Cache is reused automatically (same sessionId + content hash)
  console.log('\nSecond call - cache is reused automatically...');
  const result2 = await gen.forward(
    ai,
    { question: 'Explain the Decorator pattern.' },
    {
      sessionId,
      contextCache: {}, // Just enable caching, uses defaults
    }
  );
  console.log('Answer:', result2.answer);

  // Third call: Cache continues to be reused
  // TTL is auto-refreshed when near expiration (within refreshWindowSeconds)
  console.log('\nThird call - cache continues to be reused...');
  const result3 = await gen.forward(
    ai,
    { question: 'What are goroutines in Go?' },
    {
      sessionId,
      contextCache: {
        ttlSeconds: 14400, // New TTL for any refresh operations
      },
    }
  );
  console.log('Answer:', result3.answer);
}

// Run the example
async function main() {
  if (!process.env.GOOGLE_APIKEY) {
    console.error('Please set GOOGLE_API_KEY environment variable');
    process.exit(1);
  }

  console.log('=== Gemini Context Caching Demo ===\n');

  try {
    await runWithContextCache();
    console.log('\n\n=== Explicit Cache Management Demo ===\n');
    await runWithExplicitCacheManagement();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
