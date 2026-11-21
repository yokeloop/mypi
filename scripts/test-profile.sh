#!/usr/bin/env bash
set -euo pipefail
os="$(uname)"
now() { node -p 'Date.now()'; }
if [[ "$os" == Linux ]]; then
  [[ "$(</limits/memory.max)" == 1073741824 && "$(</limits/pids.max)" == 64 && "$(</limits/memory.swap.max)" == 0 ]]
  read -r quota period </limits/cpu.max
  [[ "$quota" != max && "$quota" -le $((period * 2)) ]]
fi
node scripts/build-state.mjs check
node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs --config .dependency-cruiser.cjs --output-type json src test > "$TMPDIR/dependencies.json" || { node scripts/admission.mjs "$TMPDIR/dependencies.json"; exit 1; }
node scripts/admission.mjs "$TMPDIR/dependencies.json"
node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs --config .dependency-cruiser.web.cjs --output-type err web/src
start_fast="$(now)"
node --permission --allow-fs-read=* --allow-fs-write=* --allow-addons \
  --test-isolation=none --test --test-concurrency=1 --test-reporter=spec dist/test/fast/*.test.js
end_fast="$(now)"
[[ $((end_fast - start_fast)) -le 5000 ]] || { echo "fast exceeds 5 seconds" >&2; exit 1; }
if [[ "$1" == verify ]]; then
  node --test --test-concurrency=1 --test-reporter=spec dist/test/boundary/*.test.js
fi
if [[ "$os" == Linux ]]; then
  # In this PID namespace only the shell and bubblewrap's reaper may remain.
  # This is a final audit, not a poller or a custom process supervisor.
  for status in /proc/[0-9]*/status; do
    pid="${status#/proc/}"; pid="${pid%/status}"
    [[ "$pid" == 1 || "$pid" == "$$" || ! -e "$status" ]] || { echo "Surviving child: $pid" >&2; exit 1; }
  done
fi
end="$(now)"
elapsed=$((end - MYPi_CHECK_START))
budget=55000
[[ "$os" != Darwin ]] || budget=70000
[[ "$1" != fast ]] || budget=5000
[[ "$elapsed" -le "$budget" ]] || { echo "Profile exceeds its working budget" >&2; exit 1; }
if [[ "$os" == Linux ]]; then
  printf 'Cost: wall=%sms fast=%sms memory_peak=%s tasks_peak=%s\n' "$elapsed" "$((end_fast - start_fast))" "$(</limits/memory.peak)" "$(</limits/pids.peak)"
  while read -r key value; do [[ "$key" != oom_kill || "$value" == 0 ]]; done </limits/memory.events
  while read -r key value; do [[ "$key" != usage_usec ]] || printf 'CPU: %s us\n' "$value"; done </limits/cpu.stat
else
  times > "$TMPDIR/times"
  cpu_us="$(node -e 'const s = t => { const [, m, x] = /^(\d+)m([\d.]+)s$/.exec(t); return Math.round((Number(m) * 60 + Number(x)) * 1e6); }; const [u, k] = require("fs").readFileSync(process.argv[1], "utf8").split("\n")[1].trim().split(/\s+/); console.log(s(u) + s(k))' "$TMPDIR/times")"
  printf 'wall=%s\nfast=%s\ncpu_us=%s\n' "$elapsed" "$((end_fast - start_fast))" "$cpu_us" > "$MYPI_COST_FILE"
fi
