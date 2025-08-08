# Ax Optimizer Service

HTTP service for Ax LLM optimization using Optuna, FastAPI, and ARQ for
background processing.

## Features

- **FastAPI**: High-performance async API with automatic documentation
- **Optuna**: Modern hyperparameter optimization with TPE, pruning, and
  visualization
- **Optional Redis**: Can run with Redis/ARQ for distributed tasks or in-memory
  for simplicity
- **Memory + Persistence**: Runs in-memory by default with optional PostgreSQL
  persistence
- **Docker**: Complete containerized setup with optional Redis and PostgreSQL
- **Zero External Dependencies Mode**: Can run entirely in-memory without Redis
  or PostgreSQL

## Quick Start

### Using Docker (Recommended)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

The API will be available at http://localhost:8000 with interactive docs at
http://localhost:8000/docs.

### Manual Setup with uv

#### Quick Start (No Configuration Required)

1. **Install uv (if not already installed):**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

2. **Install and run:**

```bash
uv sync
uv run ax-optimizer server start
# That's it! The service runs with in-memory queue by default
```

#### Production Setup (With Redis for Distributed Tasks)

1. **Install dependencies with Redis support:**

```bash
uv sync --group redis
```

2. **Start Redis:**

```bash
docker run -p 6379:6379 redis:7-alpine
```

3. **Enable Redis mode:**

```bash
export USE_MEMORY_QUEUE=false
# Or create .env file with USE_MEMORY_QUEUE=false
```

4. **Start the API server:**

```bash
uv run python -m app.main
```

5. **Start workers (in another terminal):**

```bash
uv run arq app.tasks.WorkerSettings
```

## API Usage

### Create Optimization Job

```bash
curl -X POST "http://localhost:8000/optimize" \
  -H "Content-Type: application/json" \
  -d '{
    "study_name": "my_optimization",
    "parameters": [
      {
        "name": "learning_rate",
        "type": "float",
        "low": 0.001,
        "high": 0.1,
        "log": true
      },
      {
        "name": "batch_size",
        "type": "int",
        "low": 16,
        "high": 128,
        "step": 16
      },
      {
        "name": "optimizer",
        "type": "categorical",
        "choices": ["adam", "sgd", "rmsprop"]
      }
    ],
    "objective": {
      "name": "accuracy",
      "direction": "maximize"
    },
    "n_trials": 100,
    "sampler": "TPESampler",
    "pruner": "MedianPruner"
  }'
```

Response:

```json
{
  "job_id": "123e4567-e89b-12d3-a456-426614174000",
  "study_name": "my_optimization",
  "status": "pending",
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Check Job Status

```bash
curl "http://localhost:8000/jobs/123e4567-e89b-12d3-a456-426614174000"
```

### Get Parameter Suggestions

```bash
curl -X POST "http://localhost:8000/studies/my_optimization/suggest"
```

Response:

```json
{
  "trial_number": 0,
  "params": {
    "learning_rate": 0.01,
    "batch_size": 32,
    "optimizer": "adam"
  }
}
```

### Report Trial Results

```bash
curl -X POST "http://localhost:8000/studies/my_optimization/evaluate" \
  -H "Content-Type: application/json" \
  -d '{
    "study_name": "my_optimization",
    "trial_number": 0,
    "value": 0.85,
    "intermediate_values": {
      "0": 0.1,
      "1": 0.3,
      "2": 0.6,
      "3": 0.85
    }
  }'
```

### Get Results

```bash
curl "http://localhost:8000/studies/my_optimization/results"
```

## Integration with Ax JavaScript Client

The service integrates seamlessly with the Ax MiPRO optimizer:

```typescript
// MiPro with Python service integration
import { ai, ax, type AxMetricFn, AxMiPRO } from "@ax-llm/ax";

const emailClassifier = ax(
  'emailText:string -> priority:class "critical, normal, low"',
);

const optimizer = new AxMiPRO({
  studentAI: ai({ name: "openai", apiKey: process.env.OPENAI_APIKEY! }),
  examples: trainingData,

  // Python service configuration
  optimizerEndpoint: "http://localhost:8000",
  optimizerTimeout: 60000,
  optimizerRetries: 3,

  // Advanced optimization settings
  numTrials: 100,
  bayesianOptimization: true,
  acquisitionFunction: "expected_improvement",
  // Optional: include topP (0.7–1.0) in the search space from TS side
  // When enabled, suggestions may contain a float param named `topP`
  optimizeTopP: true,
});

// Run optimization
const result = await optimizer.compile(emailClassifier, metric);
```

## CLI Usage

The service includes a comprehensive CLI for all operations:

```bash
# Start server
uv run ax-optimizer server start --debug

# Create MiPro configuration
uv run ax-optimizer mipro create-config --output config.json

# Run optimization job
uv run ax-optimizer optimize --config config.json --monitor

# Monitor job progress
uv run ax-optimizer monitor <job_id>

# Get results
uv run ax-optimizer results <study_name>
```

## API Endpoints

### Jobs

- `POST /optimize` - Create optimization job
- `GET /jobs/{job_id}` - Get job status
- `DELETE /jobs/{job_id}` - Cancel job
- `GET /jobs` - List recent jobs

### Studies

- `POST /studies/{study_name}/suggest` - Get parameter suggestions
- `POST /studies/{study_name}/evaluate` - Report trial results
- `GET /studies/{study_name}/results` - Get optimization results
- `DELETE /studies/{study_name}` - Delete study
- `GET /studies` - List all studies

### System

- `GET /health` - Health check
- `GET /docs` - Interactive API documentation

## Configuration

Environment variables:

| Variable                  | Default                    | Description               |
| ------------------------- | -------------------------- | ------------------------- |
| `HOST`                    | `0.0.0.0`                  | Server host               |
| `PORT`                    | `8000`                     | Server port               |
| `DEBUG`                   | `false`                    | Debug mode                |
| `REDIS_URL`               | `redis://localhost:6379/0` | Redis connection          |
| `DATABASE_URL`            | -                          | PostgreSQL URL (optional) |
| `USE_MEMORY_STORAGE`      | `true`                     | Use in-memory storage     |
| `MAX_TRIALS_PER_STUDY`    | `1000`                     | Maximum trials per study  |
| `DEFAULT_TIMEOUT_SECONDS` | `3600`                     | Default job timeout       |
| `MAX_CONCURRENT_JOBS`     | `10`                       | Maximum concurrent jobs   |

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Ax Client     │───▶│   FastAPI       │───▶│   ARQ Worker    │
│  (JavaScript)   │    │   (HTTP API)    │    │  (Background)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │     Redis       │    │     Optuna      │
                       │  (Task Queue)   │    │   (Studies)     │
                       └─────────────────┘    └─────────────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │   PostgreSQL    │
                                              │  (Persistence)  │
                                              └─────────────────┘
```

## Development

### Running Tests

```bash
# Install dev dependencies
uv sync --group dev

# Run tests
uv run pytest

# Run with coverage
uv run pytest --cov=app
```

### Code Formatting

```bash
# Format code
uv run black app/

# Lint code  
uv run ruff app/
```

### Adding New Features

1. Add models to `app/models.py`
2. Implement business logic in `app/optuna_service.py`
3. Add endpoints to `app/api.py`
4. Add background tasks to `app/tasks.py`
5. Update tests and documentation

## Deployment

### Production Considerations

1. **Security**: Use proper authentication, HTTPS, and secure Redis/PostgreSQL
2. **Scaling**: Deploy multiple API and worker instances behind a load balancer
3. **Monitoring**: Use logging, metrics, and health checks
4. **Persistence**: Use PostgreSQL for production workloads
5. **Backup**: Regular database backups for study persistence

### Example Production Setup

```yaml
# docker-compose.prod.yml
version: "3.8"
services:
  api:
    image: ax-optimizer:latest
    environment:
      - USE_MEMORY_STORAGE=false
      - DEBUG=false
    deploy:
      replicas: 3

  worker:
    image: ax-optimizer:latest
    command: arq app.tasks.WorkerSettings
    deploy:
      replicas: 2
```

## Troubleshooting

### Common Issues

1. **Redis connection failed**: Ensure Redis is running and accessible
2. **Database connection failed**: Check PostgreSQL configuration and
   credentials
3. **Job stuck in pending**: Check if ARQ worker is running
4. **Memory issues**: Consider using persistent storage for large studies

### Logs

```bash
# View API logs
docker-compose logs api

# View worker logs  
docker-compose logs worker

# View all logs
docker-compose logs -f
```

## License

Apache-2.0
