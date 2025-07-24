#!/bin/bash

# Start Teacher-Student Optimization Demo
# This script starts all required services for the teacher-student optimization example

set -e

echo "🎓 Starting Teacher-Student Optimization Demo"
echo "=============================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a port is in use
port_in_use() {
    lsof -i :$1 >/dev/null 2>&1
}

# Function to wait for service to be ready
wait_for_service() {
    local url=$1
    local service_name=$2
    local max_attempts=30
    local attempt=1
    
    echo "⏳ Waiting for $service_name to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" >/dev/null 2>&1; then
            echo -e "${GREEN}✅ $service_name is ready!${NC}"
            return 0
        fi
        echo "   Attempt $attempt/$max_attempts..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo -e "${RED}❌ $service_name failed to start within $((max_attempts * 2)) seconds${NC}"
    return 1
}

# Check prerequisites
echo -e "\n${BLUE}🔍 Checking prerequisites...${NC}"

if ! command_exists ollama; then
    echo -e "${RED}❌ Ollama is not installed${NC}"
    echo "Please install Ollama from: https://ollama.ai/"
    exit 1
fi

if ! command_exists docker; then
    echo -e "${RED}❌ Docker is not installed${NC}" 
    echo "Please install Docker from: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command_exists docker-compose; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    echo "Please install Docker Compose"
    exit 1
fi

echo -e "${GREEN}✅ All prerequisites found${NC}"

# Check environment variables
echo -e "\n${BLUE}🔑 Checking environment variables...${NC}"

if [ -z "$GOOGLE_APIKEY" ]; then
    echo -e "${RED}❌ GOOGLE_APIKEY environment variable is required${NC}"
    echo "Please set your Google AI API key:"
    echo "export GOOGLE_APIKEY=your_api_key_here"
    exit 1
fi

echo -e "${GREEN}✅ Environment variables configured${NC}"

# Start services
echo -e "\n${BLUE}🚀 Starting services...${NC}"

# 1. Start Ollama if not running
echo "1️⃣ Starting Ollama..."
if ! port_in_use 11434; then
    # Start Ollama in background
    ollama serve &
    OLLAMA_PID=$!
    echo "Started Ollama with PID $OLLAMA_PID"
    
    # Wait for Ollama to be ready
    if ! wait_for_service "http://localhost:11434" "Ollama"; then
        echo -e "${RED}❌ Failed to start Ollama${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Ollama is already running${NC}"
fi

# 2. Pull and run SmolLM model
echo -e "\n2️⃣ Setting up SmolLM:360m model..."
echo "📥 Pulling SmolLM model (this may take a few minutes)..."

if ! ollama list | grep -q "smollm:360m"; then
    ollama pull smollm:360m
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to pull SmolLM model${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✅ SmolLM model ready${NC}"

# 3. Start Python optimizer service
echo -e "\n3️⃣ Starting Python optimizer service..."

# Navigate to optimizer directory
OPTIMIZER_DIR="$(dirname "$0")/../src/optimizer"
if [ ! -d "$OPTIMIZER_DIR" ]; then
    echo -e "${RED}❌ Optimizer directory not found: $OPTIMIZER_DIR${NC}"
    exit 1
fi

cd "$OPTIMIZER_DIR"

# Check if already running
if port_in_use 8000; then
    echo -e "${GREEN}✅ Python optimizer service is already running${NC}"
else
    echo "🐍 Starting Python optimizer with Docker Compose..."
    docker-compose up -d
    
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Failed to start Python optimizer service${NC}"
        exit 1
    fi
    
    # Wait for service to be ready
    if ! wait_for_service "http://localhost:8000/health" "Python Optimizer"; then
        echo -e "${RED}❌ Python optimizer service failed to start${NC}"
        docker-compose logs
        exit 1
    fi
fi

# Return to original directory
cd - >/dev/null

# 4. Verify all services
echo -e "\n${BLUE}🔍 Verifying all services...${NC}"

echo "🔗 Service URLs:"
echo "   • Ollama: http://localhost:11434"
echo "   • Python Optimizer: http://localhost:8000"
echo "   • Optimizer Docs: http://localhost:8000/docs"

# Test Ollama
if curl -s "http://localhost:11434" >/dev/null; then
    echo -e "${GREEN}✅ Ollama is responding${NC}"
else
    echo -e "${RED}❌ Ollama is not responding${NC}"
    exit 1
fi

# Test Python optimizer
if curl -s "http://localhost:8000/health" >/dev/null; then
    echo -e "${GREEN}✅ Python optimizer is responding${NC}"
else
    echo -e "${RED}❌ Python optimizer is not responding${NC}"
    exit 1
fi

# All services ready
echo -e "\n${GREEN}🎉 All services are ready!${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Run the teacher-student optimization example:"
echo "   cd src/ax"
echo "   npm run tsx src/examples/teacher-student-optimization.ts"
echo ""
echo "2. Monitor services:"
echo "   • Ollama logs: check terminal output"
echo "   • Python optimizer logs: docker-compose -f src/optimizer/docker-compose.yml logs -f"
echo ""
echo "3. Stop services when done:"
echo "   • Stop Python optimizer: docker-compose -f src/optimizer/docker-compose.yml down"
echo "   • Stop Ollama: kill the ollama process or Ctrl+C"
echo ""
echo -e "${BLUE}💡 Tip: Keep this terminal open to see service status${NC}"

# Keep script running to show status
echo -e "\n${YELLOW}Press Ctrl+C to stop all services and exit${NC}"

# Trap to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🛑 Stopping services...${NC}"
    
    # Stop Python optimizer
    if [ -d "$OPTIMIZER_DIR" ]; then
        cd "$OPTIMIZER_DIR"
        docker-compose down
        cd - >/dev/null
    fi
    
    # Kill Ollama if we started it
    if [ ! -z "$OLLAMA_PID" ]; then
        kill $OLLAMA_PID 2>/dev/null || true
    fi
    
    echo -e "${GREEN}✅ Services stopped${NC}"
    exit 0
}

trap cleanup INT TERM

# Wait for user interruption
while true; do
    sleep 1
done