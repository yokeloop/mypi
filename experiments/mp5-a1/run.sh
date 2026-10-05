#!/usr/bin/env bash
# Authorized disposable MP-5 experiment, not a product launcher or test-profile replacement.
set -euo pipefail
mode="$1"
if [[ "$mode" == host || "$mode" == resume ]]; then
  root="$2"; run="$3"; pi_root="$4"; node="$5"; pane_tty="$6"
  [[ "$pane_tty" =~ ^[0-9]+$ && -t 0 && -t 1 ]]
  service_tty="$(stat -Lc %r /proc/self/fd/0)"
  [[ "$service_tty" != "$pane_tty" && -n "${INVOCATION_ID:-}" ]]
  [[ -d "$run" ]]
  if [[ "$mode" == host ]]; then
    [[ ! -e "$run/work" ]]
    mkdir -p "$run"/{work,private,bridge,context,agent,fixture,tools}
  else
    [[ -f "$run/work/probe.json" && ! -S "$run/bridge/api.sock" ]]
    if [[ -f "$run/work/ready.json" ]]; then
      cp "$run/work/ready.json" "$run/work/ready-before-resume.json"
    fi
    rm -f "$run/work/ready.json"
    cp "$run/work/probe.json" "$run/work/probe-before-resume.json"
    rm -f "$run/bridge/ready"
  fi
  cp "$root"/{probe.ts,server.mjs,bridge.mjs,offline-provider.ts,run.sh} "$run/fixture/"
  cp --reflink=auto "$node" "$run/tools/node"
  printf 'foreign-canary\n' > "$run/private/foreign.txt"
  printf 'context-canary\n' > "$run/context/read-only.txt"
  [[ "$mode" == resume ]] || ln -s /private/foreign.txt "$run/work/foreign-link"
  printf '%s\n' '{"quietStartup":true,"cacheWarming":"off","enableAnalytics":false,"enableInstallTelemetry":false,"defaultTools":["read","bash","edit","write","codemode"],"retry":{"enabled":false}}' > "$run/agent/settings.json"
  printf '%s\n' '{"mcpServers":{"scopeprobe":{"command":"/tools/node","args":["/fixture/bridge.mjs"],"exposure":"codemode"}}}' > "$run/agent/mcp.json"
  group="$(awk -F: '$1=="0"{print $3}' /proc/self/cgroup)"
  [[ "$group" == */mypi-tests.service ]]
  printf '{"paneTTYDevice":%d,"serviceTTYDevice":%d,"servicePID":%d,"serviceSID":%d}\n' \
    "$pane_tty" "$service_tty" "$$" "$(ps -o sid= -p $$)" > "$run/private/host-launch.json"
  # systemd --pty owns a distinct terminal session. Preserve its process group so
  # SIGWINCH reaches Pi; never substitute the interactive host-shell PTY.
  exec bwrap --unshare-all --die-with-parent --cap-drop ALL --clearenv \
    --ro-bind /usr /usr --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
    --proc /proc --dev /dev --tmpfs /tmp --dir /home \
    --bind "$run/work" /work --bind "$run/private" /private --bind "$run/bridge" /bridge \
    --ro-bind "$run/context" /context --bind "$run/agent" /agent \
    --ro-bind "$run/fixture" /fixture --ro-bind "$run/tools" /tools --ro-bind "$pi_root" /opt/pi \
    --ro-bind "/sys/fs/cgroup$group" /limits \
    --setenv PATH /tools:/usr/bin --setenv HOME /home --setenv TERM "${TERM:-xterm-256color}" \
    --setenv LANG C.UTF-8 --chdir /work /usr/bin/bash /fixture/run.sh outer
fi
if [[ "$mode" == outer ]]; then
  [[ "$(</limits/memory.max)" == 1073741824 && "$(</limits/pids.max)" == 64 && "$(</limits/memory.swap.max)" == 0 ]]
  read -r quota period </limits/cpu.max
  [[ "$quota" != max && "$quota" -le $((period * 2)) ]]
  /tools/node /fixture/server.mjs & server=$!
  trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true' EXIT
  # Readiness wait has a deadline; no fixed sleeps or retry-until-green.
  /tools/node -e 'const fs=require("node:fs"); if(fs.existsSync("/bridge/ready"))process.exit(); const timer=setTimeout(()=>process.exit(1),3000); const w=fs.watch("/bridge",()=>{if(fs.existsSync("/bridge/ready")){clearTimeout(timer);w.close();}});'
  set +e
  bwrap --unshare-all --unshare-user --die-with-parent --cap-drop ALL --disable-userns --clearenv \
    --ro-bind /usr /usr --symlink usr/lib /lib --ro-bind /lib64 /lib64 \
    --proc /proc --dev /dev --tmpfs /tmp --dir /home --dir /home/worker \
    --bind /work /work --bind /agent /home/worker/agent --ro-bind /context /context \
    --ro-bind /fixture /fixture --ro-bind /tools /tools --ro-bind /opt/pi /opt/pi \
    --dir /bridge --ro-bind /bridge/api.sock /bridge/api.sock \
    --setenv PATH /tools:/usr/bin --setenv HOME /home/worker --setenv LANG C.UTF-8 \
    --setenv TERM "${TERM:-xterm-256color}" --setenv PI_CODING_AGENT_DIR /home/worker/agent \
    --setenv PI_OFFLINE 1 --setenv PI_TELEMETRY 0 --setenv PI_SKIP_VERSION_CHECK 1 \
    --setenv GIT_CONFIG_NOSYSTEM 1 --setenv GIT_CONFIG_GLOBAL /dev/null --chdir /work \
    /opt/pi/pi --offline --no-approve --no-context-files --no-skills --no-prompt-templates --no-themes \
    --extension /fixture/probe.ts --extension /fixture/offline-provider.ts \
    --session-id mp5-a1-prototype --session-dir /home/worker/agent/sessions \
    --model mp5-fixture/offline --name MP5-A1-prototype
  code=$?
  set -e
  printf '\nMP5_A1_EXIT=%s\n' "$code"
  printf 'FOREIGN=%s CONTEXT=%s\n' "$(</private/foreign.txt)" "$(</context/read-only.txt)"
  for f in memory.peak pids.peak memory.events cpu.stat; do
    printf '\n%s\n' "$f"; while IFS= read -r line; do printf '%s\n' "$line"; done < "/limits/$f"
  done
  exit "$code"
fi
