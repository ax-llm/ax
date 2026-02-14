import {
  AxAIGoogleGeminiModel,
  AxRLMJSInterpreter,
  agent,
  ai,
} from '@ax-llm/ax';

const llm = ai({
  name: 'google-gemini',
  apiKey: process.env.GOOGLE_APIKEY!,
  config: { model: AxAIGoogleGeminiModel.Gemini3Flash },
});

const analyzer = agent(
  'context:string, query:string -> answer:string, evidence:string[]',
  {
    name: 'documentAnalyzer',
    description:
      'Analyzes long documents using code interpreter and sub-LM queries',
    maxSteps: 15,
    rlm: {
      contextFields: ['context'],
      // Pass permissions to grant access to specific APIs, e.g.:
      //   new AxRLMJSInterpreter({ permissions: [AxRLMJSInterpreterPermission.NETWORK] })
      interpreter: new AxRLMJSInterpreter(),
      maxLlmCalls: 30,
    },
    debug: true,
  }
);

// A long document that would normally consume the entire context window.
// RLM keeps this out of the LLM prompt and loads it into the code interpreter.
const document = `
Chapter 1: The Rise of Distributed Systems

Modern software architecture has shifted dramatically toward distributed systems.
The monolithic application, once the standard approach, has given way to microservices,
serverless functions, and event-driven architectures. This shift was driven by three
key factors: the need for horizontal scalability, team autonomy, and fault isolation.

Horizontal scalability allows organizations to handle growing workloads by adding more
machines rather than upgrading existing ones. Team autonomy enables independent deployment
cycles, reducing coordination overhead. Fault isolation ensures that a failure in one
component does not cascade to bring down the entire system.

However, distributed systems introduce their own challenges. Network partitions,
eventual consistency, and the complexity of debugging across service boundaries
create new failure modes that monolithic systems never faced.

Chapter 2: Consistency Models

The CAP theorem, formulated by Eric Brewer, states that a distributed system cannot
simultaneously provide all three guarantees: Consistency, Availability, and Partition
tolerance. In practice, since network partitions are unavoidable, systems must choose
between consistency and availability during a partition event.

Strong consistency models, such as linearizability, provide the simplest programming
model but at the cost of availability and latency. Eventual consistency, used by systems
like DynamoDB and Cassandra, prioritizes availability but requires application-level
conflict resolution.

Causal consistency offers a middle ground, preserving the order of causally related
operations while allowing concurrent operations to be observed in different orders
by different nodes.

Chapter 3: The Case for Event Sourcing

Event sourcing stores the state of an application as a sequence of events rather
than current state snapshots. Every change is captured as an immutable event, providing
a complete audit trail and enabling temporal queries.

The primary arguments for event sourcing are: complete audit history, the ability to
reconstruct past states, natural fit with event-driven architectures, and support for
CQRS (Command Query Responsibility Segregation). Critics argue that event sourcing
increases storage requirements, complicates querying current state, and requires
careful schema evolution strategies for events.
`.trim();

const result = await analyzer.forward(llm, {
  context: document,
  query: 'What are the main arguments presented across all chapters?',
});

console.log('Answer:', result.answer);
console.log('Evidence:', result.evidence);
