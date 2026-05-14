#!/bin/bash
# Dev runner for React frontend + backend + drone simulators
# Usage: ./run_dev.sh [--no-install] [num_drones] [backend_port] [frontend_port]
# Examples:
#   ./run_dev.sh              # 3 drones, backend 9002
#   ./run_dev.sh 5            # 5 drones, backend 9002
#   ./run_dev.sh 5 8000       # 5 drones, backend 8000
#   ./run_dev.sh --no-install # Skip npm install step

set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/venv"
HOST="127.0.0.1"
INTERVAL="1.0"
NO_INSTALL=0
CLEANED_UP=0
BACKEND_PID=""
DRONE_PIDS=()

POSITIONAL_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--no-install" ]; then
    NO_INSTALL=1
  else
    POSITIONAL_ARGS+=("$arg")
  fi
done

NUM_DRONES=${POSITIONAL_ARGS[0]:-3}
BACKEND_PORT=${POSITIONAL_ARGS[1]:-9002}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":$port" >/dev/null 2>&1
    return $?
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -ltn | grep -q ":$port "
    return $?
  fi

  return 1
}

wait_for_port_release() {
  local port="$1"
  local label="$2"

  echo "   Waiting for $label port $port to be released..."
  for i in {1..10}; do
    if ! port_in_use "$port"; then
      echo "   ✓ $label port available"
      return 0
    fi
    if [ "$i" -eq 10 ]; then
      echo "   ⚠️  $label port still in use, forcing..."
      fuser -k "$port"/tcp 2>/dev/null || true
      sleep 1
    else
      sleep 0.5
    fi
  done

  return 0
}

wait_for_port_ready() {
  local port="$1"
  local label="$2"

  for _ in {1..20}; do
    if port_in_use "$port"; then
      return 0
    fi
    sleep 0.5
  done

  echo "❌ $label did not become ready on port $port"
  return 1
}

cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then
    return
  fi
  CLEANED_UP=1

  echo
  echo "🛑 Shutting down..."

  if [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  for pid in "${DRONE_PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done

  wait 2>/dev/null || true
  echo "✅ Done"
}

trap cleanup EXIT
trap 'exit 0' INT TERM

# Check venv
if [ ! -f "$VENV_DIR/bin/activate" ]; then
  echo "❌ Virtual environment not found"
  echo "   Run: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

echo "🛑 Cleaning up old processes..."
# Kill only this app's known processes (for this host/ports)
pkill -f "uvicorn backend.main:app --host $HOST --port $BACKEND_PORT" 2>/dev/null || true
pkill -f "drone_sim.py --host $HOST --port $BACKEND_PORT" 2>/dev/null || true
sleep 2

wait_for_port_release "$BACKEND_PORT" "backend"

echo "🚀 Starting Swarm GSC Dev Environment"
echo "   Backend API: http://$HOST:$BACKEND_PORT"
echo "   Frontend UI: http://$HOST:$BACKEND_PORT"
echo "   Drones: $NUM_DRONES"
if [ "$NO_INSTALL" -eq 1 ]; then
  echo "   Frontend deps install: skipped (--no-install)"
fi
echo

# Source venv and set environment
export PYTHONDONTWRITEBYTECODE=1
source "$VENV_DIR/bin/activate"

# Build frontend
echo "🎨 Building frontend..."
cd "$PROJECT_DIR/frontend"
if [ "$NO_INSTALL" -eq 1 ] && [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
  echo "❌ --no-install was set, but frontend/node_modules does not exist"
  echo "   Run once without --no-install to install dependencies"
  exit 1
fi

if [ "$NO_INSTALL" -eq 1 ]; then
  echo "⏭️  Skipping npm install (--no-install)"
else
  if [ ! -d "$PROJECT_DIR/frontend/node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm ci
  else
    echo "✅ Frontend dependencies already exist (node_modules found)"
  fi
fi

# Build the frontend
echo "📦 Running npm run build..."
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Frontend build failed"
  exit 1
fi

# Start backend
echo "📡 Starting backend..."
cd "$PROJECT_DIR"
"$VENV_DIR/bin/python" -m uvicorn backend.main:app --host "$HOST" --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

# Wait for backend to be ready
if ! wait_for_port_ready "$BACKEND_PORT" "Backend"; then
  exit 1
fi

# Start drones
echo "🚁 Starting $NUM_DRONES drone(s)..."
for i in $(seq 1 $NUM_DRONES); do
  "$VENV_DIR/bin/python" "$PROJECT_DIR/drone_sim.py" --id "drone$i" --host "$HOST" --port "$BACKEND_PORT" --interval "$INTERVAL" &
  DRONE_PIDS+=($!)
  sleep 0.3
done

echo "✅ All services started. Press Ctrl+C to stop."
echo

# Keep running forever until Ctrl+C
while true; do
  sleep 1
  # Check if backend died unexpectedly
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "⚠️  Backend crashed, stopping all services..."
    exit 1
  fi
done
