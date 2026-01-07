#!/bin/bash

# Mars Mission 3D Visualization - Start Script

echo "🚀 Starting Mars Mission 3D Visualization..."
echo ""

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed or not in PATH"
    exit 1
fi

# Check if dependencies are installed
echo "📦 Checking dependencies..."
if ! python3 -c "import fastapi" 2>/dev/null; then
    echo "⚠️  Dependencies not found. Installing..."
    python3 -m pip install -r requirements.txt
fi

echo "✅ Dependencies OK"
echo ""

# Find an available port
PORT=8712
while netstat -tuln 2>/dev/null | grep -q ":$PORT " || ss -tuln 2>/dev/null | grep -q ":$PORT "; do
    PORT=$((PORT + 1))
    echo "⚠️  Port $((PORT - 1)) is in use, trying port $PORT..."
done

echo "🌐 Starting server on port $PORT..."
echo "   Open your browser and navigate to: http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the server
cd backend
python3 main.py --port $PORT
