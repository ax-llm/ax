# Ax Framework Examples

This directory contains examples demonstrating the capabilities of the Ax framework.

## Teacher-Student Optimization Example

The main example demonstrates using a large teacher model (Gemini Pro) to optimize a small student model (SmolLM:360m) for complex algorithm implementation tasks.

### Quick Start

1. **Automated Setup** (Recommended):
   ```bash
   # Start all required services automatically
   ./scripts/start-teacher-student-demo.sh
   
   # In another terminal, run the example
   cd src/ax
   npm run tsx src/examples/teacher-student-optimization.ts
   ```

2. **Manual Setup**:
   ```bash
   # Start Ollama
   ollama serve
   ollama pull smollm:360m
   
   # Start Python optimizer
   cd src/optimizer
   docker-compose up -d
   
   # Run example
   cd ../ax
   npm run tsx src/examples/teacher-student-optimization.ts
   ```

### Prerequisites

- **Ollama**: Install from [ollama.ai](https://ollama.ai/)
- **Docker & Docker Compose**: For Python optimizer service
- **Google AI API Key**: Set `GOOGLE_APIKEY` environment variable
- **Node.js 20+**: For running the TypeScript example

### What the Example Demonstrates

- **Teacher-Student Learning**: Large model (Gemini Pro) guides optimization of small model (SmolLM:360m)
- **Complex Task**: Algorithm implementation requiring understanding of data structures, edge cases, and Python syntax
- **MiPRO Optimization**: Uses the MiPRO optimizer with Python backend for advanced optimization algorithms
- **Before/After Comparison**: Shows improvement in the small model's capabilities
- **Real-world Scenario**: Demonstrates how to make small models perform complex tasks they initially can't handle

### Expected Output

The example will show:
1. Initial poor performance of the small model on algorithm implementation
2. MiPRO optimization process with progress updates (requires Python service)
3. Significantly improved performance after optimization
4. Concrete examples of generated algorithm implementations

**Note**: The example requires the Python optimizer service to be running. Without it, the optimization will fail with a clear error message.

### Architecture

```
┌─────────────────┐    guides    ┌─────────────────┐
│   Gemini Pro    │─────────────▶│   MiPRO         │
│  (Teacher)      │              │  Optimizer      │
└─────────────────┘              └─────────────────┘
                                           │
                                           ▼
┌─────────────────┐    optimizes  ┌─────────────────┐
│ Python Service  │◀──────────────│  SmolLM:360m    │
│ (Optuna/TPE)    │               │  (Student)      │
└─────────────────┘               └─────────────────┘
```

The teacher model provides high-quality examples and guidance, while the Python optimizer service uses advanced algorithms (TPE, Bayesian optimization) to find the best prompts and configurations to improve the student model's performance.

### Troubleshooting

- **Ollama connection issues**: Ensure Ollama is running on port 11434
- **Python service issues**: Check `docker-compose logs` in `src/optimizer/`
- **API key issues**: Verify `GOOGLE_APIKEY` is set correctly
- **Model download**: SmolLM:360m download may take a few minutes on first run

### Customization

You can modify the example to:
- Use different teacher/student model pairs
- Try different complex tasks (code generation, reasoning, creative writing)
- Adjust MiPRO optimization parameters
- Experiment with different evaluation metrics