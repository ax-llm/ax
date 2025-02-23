---
title: Routing
description: Use multiple AI services through a single interface, automatically routing requests to the right service based on the model specified.
---

### Multi-Service Router 

The router lets you use multiple AI services through a single interface, automatically routing requests to the right service based on the model specified.

```typescript
import { AxAI, AxMultiServiceRouter, AxAIOpenAIModel } from '@ax-llm/ax'

/// Setup OpenAI with model list
const openai = new AxAI({ 
  name: 'openai', 
  apiKey: process.env.OPENAI_APIKEY,
  models: [
    {
      key: 'basic',
      model: AxAIOpenAIModel.GPT4OMini,
      description: 'Model for very simple tasks such as answering quick short questions',
    },
    {
      key: 'medium',
      model: AxAIOpenAIModel.GPT4O,
      description: 'Model for semi-complex tasks such as summarizing text, writing code, and more',
    }
  ]
})

// Setup Gemini with model list
const gemini = new AxAI({ 
  name: 'google-gemini', 
  apiKey: process.env.GOOGLE_APIKEY,
  models: [
    {
      key: 'deep-thinker',
      model: 'gemini-2.0-flash-thinking',
      description: 'Model that can think deeply about a task, best for tasks that require planning',
    },
    {
      key: 'expert',
      model: 'gemini-2.0-pro',
      description: 'Model that is the best for very complex tasks such as writing large essays, complex coding, and more',
    }
  ]
})

const ollama = new AxAI({ 
  name: 'ollama', 
  config: { model: "nous-hermes2" }
})

const secretService = {
    key: 'sensitive-secret',
    service: ollama,
    description: 'Model for sensitive secrets tasks'
}

// Create a router with all services
const router = new AxMultiServiceRouter([openai, gemini, secretService])

// Route to OpenAI's expert model
const openaiResponse = await router.chat({
  chatPrompt: [{ role: 'user', content: 'Hello!' }],
  model: 'expert'
})

// Or use the router with AxGen
const gen = new AxGen(`question -> answer`)
const res = await gen.forward(router, { question: 'Hello!' })
```

The load balancer is ideal for high availability while the router is perfect when you need specific models for specific tasks Both can be used with any of Ax's features like streaming, function calling, and chain-of-thought prompting.

**They can also be used together**

You can also use the balancer and the router together either the multiple balancers can be used with the router or the router can be used with the balancer.

### Clear Use Cases

- **Balancer (AxBalancer):**  
  Use the balancer when you want to ensure high availability and load distribution across multiple AI services. It automatically retries requests on failures (using an exponential backoff mechanism) and chooses the service with optimal performance (for example, based on latency metrics).

- **Router (AxMultiServiceRouter):**  
  Use the router when you need explicit routing based on a model key. It aggregates models from both key–based and non–key–based services and delegates requests (chat or embed) to the underlying service that matches the provided key. This is especially useful when you have specialized models for different tasks.

### Configuration and Options

- **Balancer Options:**
  - **Debug Mode:** Toggle debug logs to see which service is being used and how retries occur.
  - **Retry Settings:** Options like `initialBackoffMs`, `maxBackoffMs`, and `maxRetries` allow you to control the retry behavior.
  - **Metric Comparator:** The default comparator (based on mean latency) can be overridden with a custom comparator if you want to prioritize services differently.

- **Router Expectations:**
  - **Unique Model Keys:** When adding services, make sure the model keys are unique. The router validates that no two services provide the same key (for non–key–based items, it aggregates the model list).
  - **Delegation Logic:** For key–based services, the router keeps the original request's model key. For non–key–based services (where a model list is provided), it delegates using the provided key from the model list.

### Error Handling and Fallback

- **Balancer Fallback:**  
  The balancer uses error classification (for example, differentiating network, authentication, or timeout errors) to decide whether to retry the same service or to switch to another available service.

- **Router Errors:**  
  If the router cannot find a service for a given model key (or if there's a conflict between key–based and non–key–based definitions), it throws an error immediately. This helps in catching configuration mistakes early.