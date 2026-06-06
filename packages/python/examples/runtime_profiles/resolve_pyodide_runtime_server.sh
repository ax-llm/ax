#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "${AXIR_REPO_ROOT:-}" ]; then
  echo "AXIR_REPO_ROOT is required so the generated package can find tools/axir/adapters/pyodide-runtime-server.ts" >&2
  exit 1
fi
REPO_ROOT="$AXIR_REPO_ROOT"
WORK_DIR="${AXIR_PYODIDE_WORKDIR:-"${TMPDIR:-/tmp}/axir-pyodide-runtime"}"

mkdir -p "$WORK_DIR"
if [ ! -d "$WORK_DIR/node_modules/pyodide" ]; then
  cp "$SCRIPT_DIR/pyodide-package.json" "$WORK_DIR/package.json"
  npm install --prefix "$WORK_DIR" --no-audit --no-fund >/dev/null
fi

printf 'env AXIR_PYODIDE_MODULE_ROOT=%s node --import=tsx %s/tools/axir/adapters/pyodide-runtime-server.ts\n' "$WORK_DIR" "$REPO_ROOT"
