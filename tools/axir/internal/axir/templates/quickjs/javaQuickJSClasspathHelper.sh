#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
POM_FILE="${1:-"$SCRIPT_DIR/quickjs4j-pom.xml"}"
WORK_DIR="${AXIR_QUICKJS4J_WORKDIR:-"${TMPDIR:-/tmp}/axir-quickjs4j-cp"}"
OUT_FILE="$WORK_DIR/classpath.txt"
M2_REPO="${AXIR_QUICKJS4J_M2_REPO:-"$WORK_DIR/m2"}"

mkdir -p "$WORK_DIR"
mvn -q -f "$POM_FILE" dependency:build-classpath -Dmaven.repo.local="$M2_REPO" -Dmdep.outputFile="$OUT_FILE" -Dmdep.includeScope=runtime
cat "$OUT_FILE"
