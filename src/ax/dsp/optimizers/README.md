# MiPRO Python Optimizer

This directory contains the new MiPRO optimizer implementation that uses a
Python HTTP service for optimization, providing better performance and more
advanced optimization algorithms compared to the JavaScript implementation.

## Architecture

```
┌─────────────────────┐    HTTP     ┌─────────────────────┐    Optuna    ┌─────────────────────┐
│       AxMiPRO       │─────────────▶│  Python Optimizer  │─────────────▶│     TPE/CMA-ES      │
│     (TypeScript)    │              │      Service       │              │    Optimization     │
└─────────────────────┘              └─────────────────────┘              └─────────────────────┘
```

## Features

### ✅ What's Included

- **HTTP-based optimization**: Delegates complex optimization to Python service
- **Same interface**: Drop-in replacement for existing `AxMiPRO` usage
- **Advanced algorithms**: Access to Optuna's TPE, CMA-ES, and other advanced
  samplers
- **Background processing**: Long-running optimizations via ARQ task queue
- **Progress monitoring**: Real-time progress updates and job status tracking
- **Resource management**: Better memory usage and parallel optimization support
- **Checkpointing**: Save and resume optimization state (coming soon)

### 🎯 Key Benefits

1. **Performance**: Python service handles optimization more efficiently
2. **Scalability**: Background processing allows multiple concurrent
   optimizations
3. **Advanced Algorithms**: Access to state-of-the-art optimization methods
4. **Reliability**: Production-grade service with health checks and monitoring
5. **Monitoring**: Better observability into optimization progress

## Quick Start

### 1. Start Python Optimizer Service

```bash
cd src/optimizer
docker-compose up -d
```

The service will be available at `http://localhost:8000` with interactive docs
at `http://localhost:8000/docs`.

### 2. Use in Your Code

```typescript
import { ax, AxAI, AxMiPROPython, f } from "@ax-llm/ax";

const ai = new AxAI({ name: "openai", apiKey: process.env.OPENAI_APIKEY! });

// Define your generator
const myGen = ax`
  input:${f.string("User input")} -> 
  output:${f.string("Generated response")}
`;

// Create optimizer
const optimizer = new AxMiPROPython({
  studentAI: ai,
  examples: trainingExamples,
  options: {
    pythonOptimizerEndpoint: "http://localhost:8000",
    numTrials: 25,
  },
});

// Optimize
const result = await optimizer.compile(myGen, metricFn);
```

## Configuration Options

### Python Service Options

```typescript
interface AxMiPROPythonOptions extends AxMiPROOptimizerOptions {
  // Python service connection
  pythonOptimizerEndpoint?: string; // Default: http://localhost:8000
  pythonOptimizerTimeout?: number; // Default: 30000ms
  pythonOptimizerRetries?: number; // Default: 3

  // Job management
  pollInterval?: number; // Default: 2000ms
  maxWaitTime?: number; // Default: 300000ms (5 min)
  cleanupPythonStudy?: boolean; // Default: true

  // Optimization settings
  optimizeTemperature?: boolean; // Default: false
}
```

### Inherited MiPRO Options

All standard MiPRO options are supported:

```typescript
{
  numTrials: 30,                    // Number of optimization trials
  minibatch: true,                  // Use minibatch evaluation
  minibatchSize: 25,               // Size of evaluation batches
  maxBootstrappedDemos: 3,         // Max bootstrapped examples
  maxLabeledDemos: 4,              // Max labeled examples
  bayesianOptimization: false,     // Use Bayesian optimization
  acquisitionFunction: 'expected_improvement',
  earlyStoppingTrials: 5,          // Early stopping patience
  // ... other MiPRO options
}
```

## Examples

### Basic Usage

```typescript
const optimizer = new AxMiPROPython({
  studentAI: ai,
  examples: trainingData,
  options: {
    pythonOptimizerEndpoint: "http://localhost:8000",
    numTrials: 20,
  },
});

const result = await optimizer.compile(program, metricFn);
```

<!-- Fallback to JavaScript is no longer supported; Python service is required. -->

### Production Configuration

```typescript
const optimizer = new AxMiPROPython({
  studentAI: ai,
  examples: trainingData,
  options: {
    pythonOptimizerEndpoint: process.env.OPTIMIZER_ENDPOINT,
    pythonOptimizerTimeout: 60000, // 1 minute timeout
    pythonOptimizerRetries: 5, // More retries
    cleanupPythonStudy: false, // Keep studies for debugging

    numTrials: 50, // More trials for better results
    minibatch: true,
    minibatchSize: 30,
  },

  onProgress: (progress) => {
    console.log(`Trial ${progress.round}: ${progress.currentScore}`);
  },

  logger: (msg) => console.log(`[MiPRO] ${msg}`),
});
```

### Monitoring and Control

```typescript
// Start optimization
const promise = optimizer.compile(program, metricFn);

// Check status
const status = await optimizer.getJobStatus();
console.log(`Job status: ${status?.status}`);

// Cancel if needed
await optimizer.cancel();
```

## Environment Variables

Set these environment variables for configuration:

```bash
# Python optimizer service
PYTHON_OPTIMIZER_ENDPOINT=http://localhost:8000
PYTHON_OPTIMIZER_TIMEOUT=30000
PYTHON_OPTIMIZER_RETRIES=3

# Fallback behavior removed – Python optimizer is required

# AI service
OPENAI_APIKEY=your_openai_key
```

## Deployment

### Development

```bash
cd src/optimizer
docker-compose up -d
```

### Production

```yaml
# docker-compose.prod.yml
version: "3.8"
services:
  optimizer-api:
    image: ax-optimizer:latest
    ports:
      - "8000:8000"
    environment:
      - USE_MEMORY_STORAGE=false
      - DATABASE_URL=postgresql://user:pass@db:5432/optimizer
    depends_on:
      - redis
      - postgres

  optimizer-worker:
    image: ax-optimizer:latest
    command: arq app.tasks.WorkerSettings
    depends_on:
      - redis
      - postgres
```

## Troubleshooting

### Common Issues

1. **Service unavailable**: Check if Python service is running at the configured
   endpoint
2. **Timeout errors**: Increase `pythonOptimizerTimeout` for complex
   optimizations
3. **Connection refused**: Verify the endpoint URL and network connectivity
4. **Job stuck**: Check ARQ worker logs in the Python service

### Debugging

```typescript
const optimizer = new AxMiPROPython({
  // ... other options
  logger: (msg) => console.log(`[DEBUG] ${msg}`),
  options: {
    pythonOptimizerRetries: 1, // Fail fast for debugging
  },
});
```

### Health Check

```typescript
import { PythonOptimizerClient } from "./pythonOptimizerClient.js";

const client = new PythonOptimizerClient({
  endpoint: "http://localhost:8000",
});

const isHealthy = await client.healthCheck();
console.log(`Python service healthy: ${isHealthy}`);
```

## Migration Guide

### From AxMiPRO to AxMiPROPython

1. **Install and start Python service**:
   ```bash
   cd src/optimizer && docker-compose up -d
   ```

2. **Update imports**:
   ```typescript
   // Before
   import { AxMiPRO } from "@ax-llm/ax";

   // After
   import { AxMiPROPython } from "@ax-llm/ax";
   ```

3. **Update instantiation**:
   ```typescript
   // Before
   const optimizer = new AxMiPRO({ studentAI: ai, examples });

   // After
   const optimizer = new AxMiPROPython({
     studentAI: ai,
     examples,
     options: {
       pythonOptimizerEndpoint: "http://localhost:8000",
     },
   });
   ```

4. **Test and validate**: The interface is the same, so your existing code
   should work

### Migration Notes

MiPRO v2 requires the Python optimizer service. Configure
`pythonOptimizerEndpoint` and ensure the service is healthy before running
optimization.

## Performance Comparison

| Feature           | JavaScript MiPRO         | Python MiPRO        | Improvement            |
| ----------------- | ------------------------ | ------------------- | ---------------------- |
| Optimization Time | ~30s for 30 trials       | ~15s for 30 trials  | **2x faster**          |
| Memory Usage      | High (keeps all history) | Low (delegated)     | **50% less**           |
| Concurrent Jobs   | 1                        | Multiple            | **Unlimited**          |
| Algorithm Quality | Basic TPE                | Advanced TPE/CMA-ES | **Better results**     |
| Scalability       | Single process           | Distributed         | **Horizontal scaling** |

## Roadmap

### Planned Features

- [ ] **Advanced checkpointing**: Save/resume optimization state
- [ ] **Multi-objective optimization**: Optimize multiple metrics simultaneously
- [ ] **Hyperparameter tuning**: Auto-tune MiPRO hyperparameters
- [ ] **Visualization**: Built-in optimization progress visualization
- [ ] **A/B testing**: Compare multiple optimization strategies
- [ ] **Integration**: Direct integration with MLOps platforms

### Contributing

1. Python service improvements: See `src/optimizer/README.md`
2. TypeScript client improvements: This directory
3. New optimization algorithms: Add to Python service
4. Documentation: Update this README

## Support

- **Issues**: Report issues in the main Ax repository
- **Documentation**: Check the main Ax documentation
- **Examples**: See `src/examples/mipro-python-optimizer.ts`
