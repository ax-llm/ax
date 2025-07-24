#!/bin/bash

# Start script for Ax Optimizer Service

echo "Starting Ax Optimizer Service..."

# Check if Redis is running
echo "Checking Redis connection..."
if ! redis-cli ping > /dev/null 2>&1; then
    echo "Warning: Redis is not accessible. Starting with Docker Compose is recommended."
fi

# Start the FastAPI server
echo "Starting FastAPI server..."
python -m app.main