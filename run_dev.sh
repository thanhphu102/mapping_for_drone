#!/bin/bash
# Simplified runner for backend + drone simulators
# Usage: ./run_dev.sh [num_drones] [port]
# Examples:
#   ./run_dev.sh              # 3 drones, port 9002
#   ./run_dev.sh 5            # 5 drones, port 9002
#   ./run_dev.sh 5 8000       # 5 drones, port 8000

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/venv"
NUM_DRONES=${1:-3}
PORT=${2:-9002}
HOST="127.0.0.1"
INTERVAL="1.0"

# Check venv
if [ ! -f "$VENV_DIR/bin/activate" ]; then
  echo "❌ Virtual environment not found"
  echo "   Run: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

echo "🛑 Cleaning up old processes..."
# Kill any existing uvicorn/drone_sim processes (graceful + force)
pkill -f "uvicorn|drone_sim" 2>/dev/null || true
sleep 2

# Wait for port to be released (max 5 seconds)
echo "   Waiting for port $PORT to be released..."
for i in {1..10}; do
  if ! lsof -i ":$PORT" >/dev/null 2>&1; then
    echo "   ✓ Port available"
    break
  fi
  if [ $i -eq 10 ]; then
    echo "   ⚠️  Port still in use, forcing..."
    fuser -k $PORT/tcp 2>/dev/null || true
    sleep 1
  else
    sleep 0.5
  fi
done

echo "🚀 Starting Swarm GSC Dev Environment"
echo "   Backend: $HOST:$PORT"
echo "   Drones: $NUM_DRONES"
echo "   WebUI: http://$HOST:$PORT"
echo

# Source venv
source "$VENV_DIR/bin/activate"

# Start backend
echo "📡 Starting backend..."
cd "$PROJECT_DIR"
uvicorn backend.main:app --host "$HOST" --port "$PORT" --reload &
BACKEND_PID=$!

# Wait for backend to be ready
sleep 3

# Start drones
echo "🚁 Starting $NUM_DRONES drone(s)..."
DRONE_PIDS=()
for i in $(seq 1 $NUM_DRONES); do
  python3 drone_sim.py --id "drone$i" --host "$HOST" --port "$PORT" &
  DRONE_PIDS+=($!)
  sleep 0.3
done

echo "✅ All services started. Press Ctrl+C to stop."
echo

# Handle cleanup
cleanup() {
  echo
  echo "🛑 Shutting down..."
  kill $BACKEND_PID "${DRONE_PIDS[@]}" 2>/dev/null || true
  sleep 1
  pkill -9 -f "uvicorn|drone_sim" 2>/dev/null || true
  echo "✅ Done"
  exit 0
}

trap cleanup EXIT INT TERM

# Keep running forever until Ctrl+C
while true; do
  sleep 1
  # Check if backend died unexpectedly
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "⚠️  Backend crashed, stopping all services..."
    break
  fi
done
