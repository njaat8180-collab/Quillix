#!/usr/bin/env bash
# =============================================================================
# Classify agent E2E failures into "environment block" vs "product defect".
#
# The agent's resource guard (src/server/resourceGuard.ts) pauses model
# requests while the machine is saturated and reports a RESUMABLE error rather
# than claiming success. When that happens, the scenario that needed another
# model request cannot finish, and the harness would otherwise report a
# product failure for a purely environmental block.
#
# This classifier keeps the two apart:
#   exit 0  -> no failures
#   exit 75 -> EVERY failure is explained by the resource guard aborting on a
#              saturated host (blocked, retry on a quieter host)
#   exit 1  -> at least one failure is NOT explained by the guard, i.e. a real
#              product defect. A busy machine can never hide a real failure.
#
# Usage: classify-failures.sh <work-dir>
# The work dir must contain failures.txt; each line is "<stream>|<message>".
# =============================================================================
set -u

WORK_DIR="${1:-}"
if [ -z "$WORK_DIR" ] || [ ! -d "$WORK_DIR" ]; then
  echo "classify-failures: work dir not found: $WORK_DIR" >&2
  exit 1
fi

FAILURES_FILE="$WORK_DIR/failures.txt"
GUARD_MESSAGE='Resource guard could not start the model request safely'
GUARD_BLOCKED=0
PRODUCT_FAILURES=0

if [ -f "$FAILURES_FILE" ]; then
  while IFS= read -r failure_line; do
    [ -n "$failure_line" ] || continue
    failure_stream="${failure_line%%|*}"
    failure_message="${failure_line#*|}"
    if [ -n "$failure_stream" ] && [ -f "$WORK_DIR/$failure_stream" ] &&
      grep -q "$GUARD_MESSAGE" "$WORK_DIR/$failure_stream"; then
      GUARD_BLOCKED=$((GUARD_BLOCKED + 1))
    else
      PRODUCT_FAILURES=$((PRODUCT_FAILURES + 1))
      echo "PRODUCT FAILURE: $failure_message"
    fi
  done < "$FAILURES_FILE"
fi

echo "CLASSIFICATION: guardBlocked=$GUARD_BLOCKED productFailures=$PRODUCT_FAILURES"

if [ "$PRODUCT_FAILURES" -eq 0 ] && [ "$GUARD_BLOCKED" -gt 0 ]; then
  echo "BLOCKED BY HOST RESOURCES - not a product failure."
  echo "The agent's resource guard aborted the model request because the machine was saturated:"
  grep -h "$GUARD_MESSAGE" "$WORK_DIR"/*.txt 2>/dev/null | head -1
  echo "The guard was not relaxed. Re-run on a quieter host (or wait for the load to drop)."
  exit 75
fi

exit 1
