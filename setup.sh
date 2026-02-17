#!/usr/bin/env bash
# setup.sh — Install dependencies and prepare environment for Law RAG app and ingestion.
# Run from law-rag-app/ or from the repo root. Idempotent: safe to run multiple times.

set -e

# --- Project root (directory containing package.json) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  PROJECT_ROOT="$SCRIPT_DIR"
else
  echo "Error: package.json not found in $SCRIPT_DIR" >&2
  exit 1
fi

cd "$PROJECT_ROOT"
echo "Project root: $PROJECT_ROOT"

# --- Node.js (required for app and ingestion) ---
check_node() {
  if command -v node >/dev/null 2>&1; then
    local ver
    ver=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
    if [ -n "$ver" ] && [ "$ver" -ge 18 ] 2>/dev/null; then
      echo "Node.js: $(node -v) (OK)"
      return 0
    fi
    echo "Node.js: $(node -v) — need 18+ (current major: $ver)" >&2
    return 1
  fi
  echo "Node.js: not found" >&2
  return 1
}

if ! check_node; then
  echo ""
  echo "Install Node.js 18+ (https://nodejs.org) or use nvm:"
  echo "  nvm install 20 && nvm use 20"
  exit 1
fi

# --- npm ---
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Install Node.js (includes npm)." >&2
  exit 1
fi
echo "npm: $(npm -v)"

# --- npm install (dependencies for app + ingestion) ---
echo ""
echo "Installing npm dependencies..."
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ] 2>/dev/null; then
  npm install
  echo "npm install done."
else
  echo "node_modules present and not older than package.json; skipping npm install (run 'npm install' to refresh)."
fi

# --- Environment for ingestion and app (.env.local) ---
ENV_LOCAL="$PROJECT_ROOT/.env.local"
ENV_EXAMPLE="$PROJECT_ROOT/.env.example"

if [ ! -f "$ENV_LOCAL" ]; then
  echo ""
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_LOCAL"
    echo "Created .env.local from .env.example. Edit .env.local with your OpenSearch and OpenAI credentials."
  else
    echo "No .env.example found. Create .env.local with OPENSEARCH_URL, OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD, OPENAI_API_KEY."
  fi
else
  echo ""
  echo ".env.local already exists; leaving it unchanged."
fi

# --- Python venv for ingestion ---
REQ_INGEST="$PROJECT_ROOT/requirements-ingest.txt"
VENV_DIR="$PROJECT_ROOT/.venv"
if [ -f "$REQ_INGEST" ]; then
  echo ""
  if ! command -v python3 >/dev/null 2>&1; then
    echo "Warning: python3 not found. Install Python 3.9+ to run the ingestion script (scripts/ingest.py)." >&2
  else
    echo "Python: $(python3 --version)"
    if [ ! -d "$VENV_DIR" ]; then
      echo "Creating virtual env at .venv ..."
      python3 -m venv "$VENV_DIR"
    fi
    echo "Installing Python ingest dependencies into .venv ..."
    "$VENV_DIR/bin/pip" install -q --upgrade pip
    "$VENV_DIR/bin/pip" install -q -r "$REQ_INGEST"
    echo "Python venv ready for ingestion."
  fi
fi

# --- Summary ---
echo ""
echo "Setup complete."
echo ""
echo "Next steps:"
echo "  1. Edit .env.local with your OPENSEARCH_* and OPENAI_API_KEY."
echo "  2. Ingest law data (Python):  source .venv/bin/activate && python scripts/ingest.py"
echo "  3. Start the app:             npm run dev"
echo ""
echo "Ingestion runs in the Python venv (.venv); the app runs with Node (npm run dev)."
