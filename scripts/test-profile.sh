#!/usr/bin/env bash
set -euo pipefail
[[ "$(</limits/memory.max)" == 1073741824 && "$(</limits/pids.max)" == 64 && "$(</limits/memory.swap.max)" == 0 ]]
read -r quota period </limits/cpu.max
[[ "$quota" != max && "$quota" -le $((period * 2)) ]]
node scripts/build-state.mjs check
node node_modules/dependency-cruiser/bin/dependency-cruiser.mjs --config .dependency-cruiser.cjs --output-type json src test > /tmp/dependencies.json || { node scripts/admission.mjs /tmp/dependencies.json; exit 1; }
node scripts/admission.mjs /tmp/dependencies.json
start_fast="$(date +%s%N)"
node --permission --allow-fs-read=* --allow-fs-write=* --allow-addons \
  --test-isolation=none --test --test-concurrency=1 --test-reporter=spec dist/test/fast/*.test.js
end_fast="$(date +%s%N)"
[[ $((end_fast - start_fast)) -le 5000000000 ]] || { echo "fast exceeds 5 seconds" >&2; exit 1; }
if [[ "$1" == verify ]]; then
  node --test --test-concurrency=1 --test-reporter=spec dist/test/boundary/*.test.js
fi
# In this PID namespace only the shell and bubblewrap's reaper may remain.
# This is a final audit, not a poller or a custom process supervisor.
for status in /proc/[0-9]*/status; do
  pid="${status#/proc/}"; pid="${pid%/status}"
  [[ "$pid" == 1 || "$pid" == "$$" || ! -e "$status" ]] || { echo "Surviving child: $pid" >&2; exit 1; }
done
end="$(date +%s%N)"
elapsed=$((end - MYPi_CHECK_START))
budget=30000000000
[[ "$1" != fast ]] || budget=5000000000
[[ "$elapsed" -le "$budget" ]] || { echo "Profile exceeds its working budget" >&2; exit 1; }
printf 'Cost: wall=%sms fast=%sms memory_peak=%s tasks_peak=%s\n' \
  "$((elapsed / 1000000))" "$(((end_fast - start_fast) / 1000000))" \
  "$(</limits/memory.peak)" "$(</limits/pids.peak)"
while read -r key value; do [[ "$key" != oom_kill || "$value" == 0 ]]; done </limits/memory.events
while read -r key value; do [[ "$key" != usage_usec ]] || printf 'CPU: %s us\n' "$value"; done </limits/cpu.stat
