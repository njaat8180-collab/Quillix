#!/usr/bin/env bash
# =============================================================================
# Quillix full-agent E2E — REAL server + REAL protocol + mock local Qwen.
#
# What this proves (end-to-end, no shortcuts):
#   1. User prompt → /api/agent/run → Ollama/Qwen protocol over HTTP
#   2. Model tool calls (text-emitted AND native) are parsed + validated
#   3. Quillix executes the real tools — files appear on the DISK
#   4. Tool results are injected back into the model conversation
#   5. The model continues and produces a clean final response
#   6. Verification, repair (test→fix→retest), project memory and the
#      file-location report all run against real filesystem state.
#
# Scenarios:
#   S1 "Create a file named test.html containing a simple HTML page."
#      → single file at the workspace root, absolute path reported.
#   S2 "Create a calculator project."
#      → Calculator/ folder with index.html + style.css + script.js,
#        detected as a previewable web project, preview serves the HTML.
#   S3 "Create a To-Do List web application" (mock ships a BROKEN app.js)
#      → automatic validation catches it → model repairs it → retest passes.
#   S4 "Help me build a car game using Python"
#      → model replies conversationally → engine redirects it to tools →
#        project built → real python run FAILS (pygame missing) → model
#        fixes it → retest passes → only then Phase 15 completes.
#
# Usage: bash scripts/e2e/agent-e2e.sh
# =============================================================================
set -u
cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"

PORT="${QUILLIX_E2E_PORT:-3000}"
MOCK_PORT="${QUILLIX_E2E_MOCK_PORT:-11499}"
WORK_DIR="$(mktemp -d /tmp/quillix-agent-e2e.XXXXXX)"
WS="$WORK_DIR/workspace"
FAKE_HOME="$WORK_DIR/home"
SERVER_BUNDLE="$REPO_ROOT/.e2e/server.cjs"
PASS=0
FAIL=0

# Git Bash on Windows exposes /tmp as a POSIX path, but Node resolves an
# absolute /tmp path as C:\\tmp. Keep POSIX paths for shell filesystem checks
# and pass native Windows paths to the real Quillix server and Node tools.
if command -v cygpath >/dev/null 2>&1; then
  WS_NATIVE="$(cygpath -w "$WS")"
  SETTINGS_NATIVE="$(cygpath -w "$FAKE_HOME/.quillix/settings.json")"
else
  WS_NATIVE="$WS"
  SETTINGS_NATIVE="$FAKE_HOME/.quillix/settings.json"
fi

path_in_stream() {
  local stream_file="$1"
  local expected="$2"
  local normalized_expected normalized_stream
  normalized_expected="$(printf '%s' "$expected" | sed -E 's#\\#/#g; s#/{2,}#/#g')"
  normalized_stream="$(sed -E 's#\\#/#g; s#/{2,}#/#g' "$stream_file" 2>/dev/null || true)"
  printf '%s' "$normalized_stream" | grep -qF "$normalized_expected" && return 0
  if command -v cygpath >/dev/null 2>&1; then
    local mixed escaped
    mixed="$(cygpath -m "$expected" 2>/dev/null || true)"
    [ -n "$mixed" ] && printf '%s' "$normalized_stream" | grep -qF "$mixed" && return 0
    escaped="$(printf '%s' "$expected" | sed 's/\\\\/\\\\\\\\/g')"
    grep -qF "$escaped" "$stream_file" 2>/dev/null && return 0
  fi
  return 1
}

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  rm -rf "$REPO_ROOT/.e2e" 2>/dev/null
}
trap cleanup EXIT

say()  { printf '%s\n' "$*"; }
pass() { PASS=$((PASS + 1)); say "PASS — $*"; }
fail() { FAIL=$((FAIL + 1)); say "FAIL — $*"; }

# Locate esbuild (node_modules or global npx fallback)
if [ -x "node_modules/.bin/esbuild" ]; then
  ESBUILD="node_modules/.bin/esbuild"
elif [ -x "node_modules/@esbuild/linux-x64/bin/esbuild" ]; then
  ESBUILD="node_modules/@esbuild/linux-x64/bin/esbuild"
else
  ESBUILD="$(command -v esbuild || true)"
fi
if [ -z "$ESBUILD" ]; then
  say "esbuild not found — run: npm install"; exit 1
fi

mkdir -p "$WS" "$FAKE_HOME/.quillix" "$REPO_ROOT/.e2e"
cat > "$FAKE_HOME/.quillix/settings.json" <<EOF
{
  "model": "qwen2.5-coder:3b",
  "ollamaBaseUrl": "http://127.0.0.1:$MOCK_PORT",
  "offlineMode": true,
  "maxAutonomousTurns": 12,
  "temperature": 0.2,
  "terminalApproval": false,
  "gitApproval": true,
  "autoApplyDiffs": true,
  "theme": "dark"
}
EOF

say "== Building the real Quillix server (esbuild bundle) =="
"$ESBUILD" server.ts --bundle --platform=node --format=cjs --packages=external \
  --outfile="$SERVER_BUNDLE" --log-level=error || { say "Bundle failed"; exit 1; }

say "== Starting mock Ollama (qwen2.5-coder:3b simulator) on 127.0.0.1:$MOCK_PORT =="
QUILLIX_MOCK_OLLAMA_PORT="$MOCK_PORT" node scripts/e2e/mock-ollama.cjs > "$WORK_DIR/mock.log" 2>&1 &
MOCK_PID=$!
sleep 1

say "== Starting the real Quillix server on 127.0.0.1:$PORT =="
# --require fetch-polyfill (absolute path): pure node:http fetch for environments where
# Node's undici cannot allocate its llhttp WASM. The Quillix code path and
# the wire protocol are unchanged.
# QUILLIX_MAX_CPU_PERCENT: this harness talks to an in-process mock provider that
# answers instantly, so host CPU contention must not starve the agent. Production
# keeps the default 90% ceiling (src/server/resourceGuard.ts).
NODE_ENV=production PORT="$PORT" QUILLIX_SETTINGS_PATH="$SETTINGS_NATIVE" \
  QUILLIX_MAX_CPU_PERCENT=100 \
  node --require "$REPO_ROOT/scripts/e2e/fetch-polyfill.cjs" "$SERVER_BUNDLE" \
  > "$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!

# Wait for the health endpoint to answer instead of guessing at a delay: on
# Windows the bundled server (esbuild + dependency scan) can legitimately need
# 10-30s to boot, and a fixed short sleep fails the whole harness with an empty
# log on a slow or memory-constrained host.
SERVER_READY=0
for _ in $(seq 1 60); do
  if curl -s "http://127.0.0.1:$PORT/api/health" > /dev/null 2>&1; then
    SERVER_READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    say "Server process exited before it became healthy — log:"; cat "$WORK_DIR/server.log"; exit 1
  fi
  sleep 1
done

if [ "$SERVER_READY" -ne 1 ]; then
  say "Server did not start — log:"; cat "$WORK_DIR/server.log"; exit 1
fi

SET_ROOT_BODY="$(WS_NATIVE="$WS_NATIVE" node -e 'process.stdout.write(JSON.stringify({targetPath: process.env.WS_NATIVE}))')"
SET_ROOT_RESPONSE="$(curl -s -X POST "http://127.0.0.1:$PORT/api/workspace/set-root" \
  -H 'Content-Type: application/json' --data-binary "$SET_ROOT_BODY")"
if ! echo "$SET_ROOT_RESPONSE" | grep -q '"success":true'; then
  say "Workspace did not start — set-root response: $SET_ROOT_RESPONSE"
  say "Server log:"
  cat "$WORK_DIR/server.log"
  exit 1
fi

# Runs one agent scenario over the real SSE endpoint; stores the stream.
run_agent() { # $1 = prompt, $2 = output file
  curl -s -N --max-time 120 -X POST "http://127.0.0.1:$PORT/api/agent/run" \
    -H 'Content-Type: application/json' \
    -d "$(node -e 'process.stdout.write(JSON.stringify({ userPrompt: process.argv[1], mode: "agent", conversationMode: "agent", conversationHistory: [] }))' "$1")" \
    > "$2"
}

done_text() { grep '"event":"done"' "$1" | tail -1; }

# =============================================================================
say ""
say "== S1: single file — \"Create a file named test.html containing a simple HTML page.\" =="
run_agent "Create a file named test.html containing a simple HTML page." "$WORK_DIR/s1.txt"

if [ -f "$WS/test.html" ]; then
  pass "S1: test.html physically exists on disk at the workspace root"
else
  fail "S1: test.html NOT created"
fi
if grep -q 'Simple HTML Page' "$WS/test.html" 2>/dev/null; then
  pass "S1: test.html has the expected content"
else
  fail "S1: test.html content wrong"
fi
DIRS=$(find "$WS" -maxdepth 1 -mindepth 1 -type d ! -name '.quillix' | wc -l)
if [ "$DIRS" -eq 0 ]; then
  pass "S1: no project folder created for a single-file request"
else
  fail "S1: unexpected project folder created"
fi
if path_in_stream "$WORK_DIR/s1.txt" "$WS_NATIVE\\test.html"; then
  pass "S1: final response reports the exact absolute path"
else
  fail "S1: absolute path missing from final response"
fi
if grep '"event":"token"' "$WORK_DIR/s1.txt" | grep -q 'file_write'; then
  fail "S1: raw tool JSON leaked into chat tokens"
else
  pass "S1: chat tokens contain no raw tool JSON"
fi

# =============================================================================
say ""
say "== S2: project — \"Create a calculator project.\" =="
run_agent "Create a calculator project." "$WORK_DIR/s2.txt"

CALC="$WS/Calculator"
for f in index.html style.css script.js; do
  if [ -f "$CALC/$f" ]; then pass "S2: Calculator/$f exists on disk"; else fail "S2: Calculator/$f missing"; fi
done
CALC_NATIVE="$WS_NATIVE\\Calculator"
if path_in_stream "$WORK_DIR/s2.txt" "$CALC_NATIVE"; then
  pass "S2: final response reports the exact absolute project root"
else
  fail "S2: project root missing from final response"
fi
if path_in_stream "$WORK_DIR/s2.txt" "$CALC_NATIVE\\index.html"; then
  pass "S2: final response lists absolute file paths"
else
  fail "S2: file paths missing from final response"
fi

# Detect + run/verify the website project through the language runner API.
DET=$(curl -s -G "http://127.0.0.1:$PORT/api/project/detect" --data-urlencode "root=$CALC_NATIVE")
if echo "$DET" | grep -q '"language":"static-web"'; then
  pass "S2: language runner detects the web project"
else
  fail "S2: language runner failed to detect: $DET"
fi
if echo "$DET" | grep -q '"previewable":true'; then
  pass "S2: project detected as previewable"
else
  fail "S2: not previewable"
fi
PREVIEW_HTML=$(curl -s "http://127.0.0.1:$PORT/preview/Calculator/index.html")
if echo "$PREVIEW_HTML" | grep -q 'Calculator'; then
  pass "S2: built-in preview serves the real index.html"
else
  fail "S2: preview did not serve the site"
fi
if grep -q 'Calculator' "$WS/.quillix/memory.json" 2>/dev/null; then
  pass "S2: project memory recorded Calculator"
else
  fail "S2: memory missing"
fi

# Follow-up in the same project: prove that a second user request is treated
# as a continuation/edit, not as a fresh chatbot answer or a new project.
say ""
say "== S2-follow-up: continue the existing Calculator project =="
S2_BEFORE=$(find "$WS" -maxdepth 1 -mindepth 1 -type d ! -name '.quillix' | sort)
run_agent "Add a percentage button to the existing Calculator project and connect it in the current files." "$WORK_DIR/s2-follow-up.txt"
S2_AFTER=$(find "$WS" -maxdepth 1 -mindepth 1 -type d ! -name '.quillix' | sort)
if [ "$S2_BEFORE" = "$S2_AFTER" ] && grep -q "'%'" "$CALC/script.js"; then
  pass "S2-follow-up: existing Calculator was edited in place"
else
  fail "S2-follow-up: existing project was not edited in place"
fi
if done_text "$WORK_DIR/s2-follow-up.txt" | grep -Eqi 'percentage|updated|Calculator'; then
  pass "S2-follow-up: final response confirms continuation work"
else
  fail "S2-follow-up: continuation response missing"
fi
if ! grep -qi 'chatbot' "$WORK_DIR/s2-follow-up.txt"; then
  pass "S2-follow-up: continuation stayed in coding workflow"
else
  fail "S2-follow-up: chatbot-style response detected"
fi

# =============================================================================
say ""
say "== S3: test → fix → retest — \"Create a professional responsive To-Do List web application\" =="
run_agent "Create a professional responsive To-Do List web application" "$WORK_DIR/s3.txt"

# .quillix is Quillix's own metadata directory, not the generated project.
TODO_DIR=$(find "$WS" -maxdepth 1 -mindepth 1 -type d ! -name 'Calculator' ! -name '.quillix' | head -1)
if [ -n "$TODO_DIR" ] && [ -f "$TODO_DIR/index.html" ]; then
  pass "S3: project folder + index.html created ($(basename "$TODO_DIR"))"
else
  fail "S3: project folder/index.html missing"
fi
for f in style.css app.js README.md; do
  if [ -f "$TODO_DIR/$f" ]; then pass "S3: $f exists"; else fail "S3: $f missing"; fi
done
if node --check "$TODO_DIR/app.js" 2> "$WORK_DIR/appjs.err"; then
  pass "S3: app.js is valid JavaScript (broken file was really repaired)"
else
  fail "S3: app.js still broken: $(cat "$WORK_DIR/appjs.err")"
fi
if grep -q '"event":"activity"' "$WORK_DIR/s3.txt" && \
   grep '"event":"activity"' "$WORK_DIR/s3.txt" | grep -q 'validation'; then
  pass "S3: automatic validation ran (visible in the activity stream)"
else
  fail "S3: no validation activity"
fi
TODO_NATIVE="$WS_NATIVE\\$(basename "$TODO_DIR")"
if path_in_stream "$WORK_DIR/s3.txt" "$TODO_NATIVE"; then
  pass "S3: final response reports the project root"
else
  fail "S3: project root missing"
fi
if grep '"event":"token"' "$WORK_DIR/s3.txt" | grep -q '"name"'; then
  fail "S3: tool JSON leaked into chat"
else
  pass "S3: chat stayed clean (no tool JSON, code hidden)"
fi

# =============================================================================
say ""
say "== S4: Python project + nudge + real run/fix/retest — \"Help me build a car game using Python\" =="
run_agent "Help me build a car game using Python" "$WORK_DIR/s4.txt"

CAR="$WS/CarGame"
for f in main.py README.md; do
  if [ -f "$CAR/$f" ]; then pass "S4: CarGame/$f exists on disk"; else fail "S4: CarGame/$f missing"; fi
done
if python3 -m py_compile "$CAR/main.py" 2> "$WORK_DIR/py.err"; then
  pass "S4: main.py is valid Python (repaired by the real error->fix->retest loop)"
else
  fail "S4: main.py invalid: $(cat "$WORK_DIR/py.err")"
fi
if grep -q 'requesting real file creation' "$WORK_DIR/s4.txt"; then
  pass "S4: engine redirected the conversational model to real tool usage"
else
  fail "S4: nudge never fired"
fi
if grep -q 'Runtime error' "$WORK_DIR/s4.txt"; then
  pass "S4: real runtime error (pygame missing) was captured and fed back"
else
  fail "S4: runtime error never captured"
fi
if done_text "$WORK_DIR/s4.txt" | grep -q 'executed successfully'; then
  pass "S4: Python runner executed the project successfully after the fix"
else
  fail "S4: project was never executed successfully"
fi
CAR_NATIVE="$WS_NATIVE\\CarGame"
if path_in_stream "$WORK_DIR/s4.txt" "$CAR_NATIVE"; then
  pass "S4: final response reports the exact absolute project root"
else
  fail "S4: project root missing from final response"
fi
if done_text "$WORK_DIR/s4.txt" | grep -q '"id":"completion"[^}]*"status":"completed"'; then
  pass "S4: Phase 15 (Completion Report) shows COMPLETED — only after verification"
else
  fail "S4: completion phase not COMPLETED"
fi
if grep -q '"python"' "$WS/.quillix/memory.json" 2>/dev/null; then
  pass "S4: project memory recorded the Python project"
else
  fail "S4: memory missing python project"
fi
if grep '"event":"token"' "$WORK_DIR/s4.txt" | grep -q 'create_file'; then
  fail "S4: raw tool JSON leaked into chat"
else
  pass "S4: chat stayed clean"
fi

# =============================================================================
say ""
say "== S5: Python calculator — \"Create a Python calculator.\" =="
S5_BEFORE=$(ls -A "$WS" 2>/dev/null)
run_agent "Create a Python calculator." "$WORK_DIR/s5.txt"
# The engine derives the folder from the prompt (stopword-filtered) and
# disambiguates against existing folders - detect the NEW folder by diff.
PCALC=$(comm -13 <(echo "$S5_BEFORE" | sort) <(ls -A "$WS" | sort) | grep -v '^\.quillix$' | head -1)
PCALC="$WS/$PCALC"
if [ -n "$PCALC" ] && [ -f "$PCALC/calculator.py" ]; then
  pass "S5: $PCALC/calculator.py exists on disk"
else
  fail "S5: calculator.py missing"
fi
for f in requirements.txt README.md; do
  if [ -f "$PCALC/$f" ]; then pass "S5: $f exists"; else fail "S5: $f missing"; fi
done
if python3 -m py_compile "$PCALC/calculator.py" 2> "$WORK_DIR/pcalc.err"; then
  pass "S5: calculator.py is valid Python (py_compile)"
else
  fail "S5: calculator.py invalid: $(cat "$WORK_DIR/pcalc.err")"
fi
if python3 "$PCALC/calculator.py" 2> "$WORK_DIR/pcalc.run" | grep -q '6 \* 7 = 42'; then
  pass "S5: calculator actually runs and computes 6 * 7 = 42"
else
  fail "S5: calculator did not run correctly: $(cat "$WORK_DIR/pcalc.run" 2>/dev/null)"
fi
if done_text "$WORK_DIR/s5.txt" | grep -q 'executed successfully'; then
  pass "S5: the engine really executed the project (Python runner)"
else
  fail "S5: project was never executed successfully"
fi
PCALC_NATIVE="$WS_NATIVE\\$(basename "$PCALC")"
if path_in_stream "$WORK_DIR/s5.txt" "$PCALC_NATIVE"; then
  pass "S5: final response reports the exact absolute project root"
else
  fail "S5: project root missing from final response"
fi
if grep -q 'def calculate' "$PCALC/calculator.py"; then
  pass "S5: calculator.py contains real implementation code (not a placeholder)"
else
  fail "S5: calculator.py has no real implementation"
fi

# =============================================================================
say ""
say "== S6: Node.js application — \"Create a Node.js application.\" =="
S6_BEFORE=$(ls -A "$WS" 2>/dev/null)
run_agent "Create a Node.js application." "$WORK_DIR/s6.txt"
NAPP=$(comm -13 <(echo "$S6_BEFORE" | sort) <(ls -A "$WS" | sort) | grep -v '^\.quillix$' | head -1)
NAPP="$WS/$NAPP"
if [ -n "$NAPP" ] && [ -f "$NAPP/package.json" ]; then
  pass "S6: $NAPP/package.json exists on disk"
else
  fail "S6: package.json missing"
fi
if [ -f "$NAPP/index.js" ]; then pass "S6: index.js exists"; else fail "S6: index.js missing"; fi
if [ -f "$NAPP/README.md" ]; then pass "S6: README.md exists"; else fail "S6: README.md missing"; fi
if node --check "$NAPP/index.js" 2> "$WORK_DIR/nodeapp.err"; then
  pass "S6: index.js is valid JavaScript (node --check)"
else
  fail "S6: index.js invalid: $(cat "$WORK_DIR/nodeapp.err")"
fi
NODE_OUT=$(cd "$NAPP" && npm start --silent 2>&1)
if echo "$NODE_OUT" | grep -q 'Total notes'; then
  pass "S6: npm start actually runs the application"
else
  fail "S6: npm start failed: $NODE_OUT"
fi
if done_text "$WORK_DIR/s6.txt" | grep -q 'executed successfully'; then
  pass "S6: the engine executed the Node project (npm start)"
else
  fail "S6: project was never executed by the engine"
fi
if grep -q '"start"' "$NAPP/package.json"; then
  pass "S6: package.json defines a start script"
else
  fail "S6: package.json has no start script"
fi

# =============================================================================
say ""
say "== S7: bug-fix — intentionally broken project, \"Fix this broken project.\" =="
mkdir -p "$WS/BrokenApp"
cat > "$WS/BrokenApp/main.py" <<'BROKEN'
# BrokenApp - intentionally broken (syntax errors).
def greet(name:
    return "Hello, " + name

if __name__ == '__main__':
    print(greet("World")
BROKEN
if python3 -m py_compile "$WS/BrokenApp/main.py" 2> /dev/null; then
  fail "S7: test setup error - the file should be broken before the agent runs"
else
  pass "S7: confirmed the input file is genuinely broken before the fix"
fi

run_agent "Fix the syntax errors in BrokenApp/main.py." "$WORK_DIR/s7.txt"

if python3 -m py_compile "$WS/BrokenApp/main.py" 2> "$WORK_DIR/fix.err"; then
  pass "S7: BrokenApp/main.py now compiles (agent really fixed it)"
else
  fail "S7: file still broken: $(cat "$WORK_DIR/fix.err")"
fi
if python3 "$WS/BrokenApp/main.py" | grep -q 'Hello, World'; then
  pass "S7: the fixed program runs and prints Hello, World"
else
  fail "S7: fixed program does not run correctly"
fi
if grep -q 'def greet(name):' "$WS/BrokenApp/main.py"; then
  pass "S7: the fix was a MINIMAL surgical edit (unclosed parameter list closed)"
else
  fail "S7: expected minimal fix not found in file"
fi
if grep '"event":"activity"' "$WORK_DIR/s7.txt" | grep -q 'Reading BrokenApp/main.py'; then
  pass "S7: agent inspected the broken source before modifying it"
else
  fail "S7: agent never read the file first"
fi
if done_text "$WORK_DIR/s7.txt" | grep -qi 'fixed'; then
  pass "S7: final response reports the fix"
else
  fail "S7: fix not reported"
fi

# =============================================================================
say ""
say "== S8: persistent task state + resume records (§21) =="
TASKS=$(curl -s "http://127.0.0.1:$PORT/api/tasks")
for REQ in 'Python calculator' 'Node.js application' 'BrokenApp'; do
  if echo "$TASKS" | grep -qF "$REQ"; then
    pass "S8: task store records the request: $REQ"
  else
    fail "S8: task store missing request: $REQ"
  fi
done
if echo "$TASKS" | grep -q '"status":"completed"'; then
  pass "S8: completed tasks are persisted with verified status"
else
  fail "S8: no completed task found in the store"
fi
if echo "$TASKS" | grep -q 'py_compile'; then
  pass "S8: real executed commands (py_compile) are recorded in task history"
else
  fail "S8: executed commands not recorded"
fi
INCOMPLETE=$(curl -s "http://127.0.0.1:$PORT/api/tasks/latest-incomplete")
if echo "$INCOMPLETE" | grep -q '"task":null'; then
  pass "S8: no task is left in 'running' state after successful completion"
else
  fail "S8: a task is stuck in running state: $INCOMPLETE"
fi
BAD_RESUME=$(curl -s -X POST "http://127.0.0.1:$PORT/api/tasks/task_does_not_exist/resume-context")
if echo "$BAD_RESUME" | grep -q 'Unknown task'; then
  pass "S8: resume for an unknown task fails honestly"
else
  fail "S8: unknown-task resume did not fail"
fi

# Simulate an interrupted task: a record on disk plus a HALF-created project
# (one file exists, one was recorded but never written).
mkdir -p "$WS/ResumeTest"
printf 'print("half-done")\n' > "$WS/ResumeTest/main.py"
python3 - "$WS" <<'PYTASK'
import json, sys
ws = sys.argv[1]
path = ws + "/.quillix/tasks.json"
with open(path) as fh:
    tasks = json.load(fh)
tasks.append({
    "id": "task_e2e_resume",
    "userRequest": "Build the resume test project",
    "mode": "agent",
    # A restarted TaskStateStore converts stale running records to cancelled.
    # Inject the recovered state here because this harness keeps its server live.
    "status": "cancelled",
    "createdAt": 1,
    "updatedAt": 1,
    "filesCreated": ["ResumeTest/main.py", "ResumeTest/README.md"],
    "filesModified": [],
    "filesDeleted": [],
    "commandsExecuted": [{"command": "python3 -m py_compile main.py", "cwd": ws + "/ResumeTest", "exitCode": 0, "durationMs": 9, "timestamp": 1}],
    "errors": ["interrupted mid-run"],
    "retryCount": 0,
})
with open(path, "w") as fh:
    json.dump(tasks, fh)
PYTASK
RES=$(curl -s -X POST "http://127.0.0.1:$PORT/api/tasks/task_e2e_resume/resume-context" -H 'Content-Type: application/json' -d '{}')
if echo "$RES" | grep -q 'already created and verified on disk: ResumeTest/main.py'; then
  pass "S8: resume context lists files VERIFIED on disk"
else
  fail "S8: resume context does not distinguish verified files: $RES"
fi
if echo "$RES" | grep -q 'NOT on disk (recreate them): ResumeTest/README.md'; then
  pass "S8: resume context flags recorded-but-missing files for recreation"
else
  fail "S8: resume context did not flag the missing file"
fi
if echo "$RES" | grep -q 'python3 -m py_compile main.py (exit 0)'; then
  pass "S8: resume context carries real executed-command history"
else
  fail "S8: command history missing from resume context"
fi

# =============================================================================
say ""
say "================================================"
say "AGENT E2E RESULT: $PASS passed, $FAIL failed"
if [ "$FAIL" -eq 0 ]; then
  say "ALL AGENT E2E CHECKS PASSED"
  exit 0
else
  say "FAILURES DETECTED — server log: $WORK_DIR/server.log"
  exit 1
fi
