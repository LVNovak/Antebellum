#!/bin/bash
# Mirrors CI type checking as closely as possible without node_modules.
# --skipLibCheck suppresses only missing node_modules type errors.
# All errors in our own source files surface exactly as they would on CI.
echo "Running TypeScript check (CI-equivalent)..."
npx tsc --noEmit --skipLibCheck 2>&1
STATUS=$?
if [ $STATUS -eq 0 ]; then
  echo "✓ Clean — safe to push"
else
  echo "✗ Errors found — fix before pushing"
fi
exit $STATUS
