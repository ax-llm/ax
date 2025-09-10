# Multi-stage build for smaller final image
FROM python:3.11-slim as builder

# Install uv for fast package management
RUN pip install --no-cache-dir uv

# Set working directory
WORKDIR /app

# Copy dependency files
COPY pyproject.toml ./

# Install dependencies using uv
RUN uv sync --no-dev

# Production stage
FROM python:3.11-slim

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash app

# Set working directory
WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --chown=app:app app/ ./app/
COPY --chown=app:app cli.py ./
COPY --chown=app:app pyproject.toml ./

# Create directories for data persistence
RUN mkdir -p /app/data /app/logs && chown -R app:app /app

# Switch to non-root user
USER app

# Environment variables with defaults
ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    DEBUG=false \
    USE_MEMORY_STORAGE=true \
    USE_MEMORY_QUEUE=true \
    MAX_TRIALS_PER_STUDY=1000 \
    DEFAULT_TIMEOUT_SECONDS=3600 \
    MAX_CONCURRENT_JOBS=10 \
    LOG_LEVEL=INFO

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Expose port
EXPOSE 8000

# Default command - start the API server
CMD ["python", "-m", "app.main"]