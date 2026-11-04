# Terminal UI

`tui/bin/mypi-tui` is a terminal browser of the mypi database: projects, tasks,
events (including parent messages) and the journal. It reads only through the
HTTP API of `mypi serve` ([HTTP-API.md](HTTP-API.md)) and never writes; the one
action besides reading is "open", which runs `mypi open` for a project or task row.
It runs in any terminal, over ssh from a phone, or as a Herdr plugin tab.

## Build

```bash
mise install                    # installs the pinned Rust 1.99.1 through rustup
mise exec -- pnpm tui:fetch     # network: the locked crates into tui/target/cargo-home
mise exec -- pnpm tui:build     # tui/bin/mypi-tui (release)
```

`tui:fetch` is needed once per checkout and again when `tui/Cargo.lock` changes.
`tui/target/` and `tui/bin/` are ignored by Git.

## Token

The TUI needs a read token from `mypi token create`. Keep it in a private file:

```bash
mkdir -p -m 700 "${XDG_CONFIG_HOME:-$HOME/.config}/mypi"
(umask 077; mise exec -- node dist/src/cli/main.js token create tui --permission read \
  | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).token' > "${XDG_CONFIG_HOME:-$HOME/.config}/mypi/tui-token")
```

Or set `MYPI_API_TOKEN`, which wins over the file. The file
`$XDG_CONFIG_HOME/mypi/tui-token` (else `~/.config/mypi/tui-token`) must be a
regular file, not a symlink, with no group or other permissions (0600); otherwise
the TUI refuses to start. A missing or malformed token is reported before the
terminal switches to full screen, with exit code 2.

## Run in a terminal

```bash
<engine>/tui/bin/mypi-tui [--url http://HOST:PORT]
```

The URL defaults to `MYPI_API_URL`, else `http://127.0.0.1:8737`. Only `http://`
is supported: run the TUI on the machine of `mypi serve` (over ssh from a phone it
is the same binary on that machine) or reach the server over Tailscale.
`mypi-tui --help` prints the usage, `--version` the version.

## Herdr plugin

Installing the plugin and binding a key are user configuration; the engine never
changes `~/.config/herdr/`. To use it:

```bash
herdr plugin link <engine>/tui
```

The action `yokeloop.mypi.browse` opens a new `mypi` tab with the TUI
(`tui/herdr-plugin.toml`). An example binding in `~/.config/herdr/config.toml`:

```toml
[[keys.command]]
key = "prefix+shift+d"
type = "plugin_action"
command = "yokeloop.mypi.browse"
description = "mypi database"
```

then `herdr server reload-config`. Clicks reach the TUI while Herdr's
`ui.mouse_capture` is on. After `pnpm tui:build` new tabs take the new binary;
open tabs keep the old one until they are restarted.

## Screens and filters

Four sections: `1 Projects`, `2 Tasks` (the start section), `3 Events`,
`4 Journal`. Each row shows the main fields; the details show every known field,
then unknown ones under "Other fields".

| Section | Filters (f) | Search (/) |
| --- | --- | --- |
| Projects | `org` | `q` on code and identity, in the TUI |
| Tasks | `project`, `status` | `q` on the server |
| Events | `to`, `from`, `kind` (any, turn_end, waiting, milestone, message), `delivered` (all, pending, delivered) | `q` on the server |
| Journal | `scope`, `type` (any, note, task_created, status_changed), `from`, `to` (YYYY-MM-DD) | `q` on the server |

The journal `scope` filter takes a project code or a task key and sends them as
`project:<CODE>` and `task:<KEY>`; other references (`global`, `org:fx`,
`org/project`) go as typed. Dates are whole UTC days. Pages hold 50 rows: the last
row `▼ Load more`, `m`, or `↓` on the last row loads the next page. Events marked
`●` are not delivered yet; the TUI never marks them delivered.

## Keys and mouse

| Key | Action |
| --- | --- |
| `Tab` / `Shift-Tab`, `1`-`4` | switch section |
| `j` `k`, `↓` `↑`, `PgDn` `PgUp`, `g` `G`, `Home` `End` | move; in the details: scroll |
| `Enter` | details |
| `Esc`, `Backspace` | back: leaves the details (`f`/`Esc` close the filter form, any key closes help) |
| `o` | open the session tab of a project or task row |
| `r` | refresh the section |
| `m` | load more |
| `/` | search: type, `Enter` applies, `Ctrl-U` clears, `Esc` cancels |
| `f` | the filter form: `↑` `↓` choose, `Enter`/space edit or cycle, `x` clear, `f`/`Esc` apply |
| `J` `K` | scroll the details |
| `?` | help |
| `q`, `Ctrl-C` | quit |

Mouse: click a tab, a row (the first click selects, the second opens the details),
a button of the bottom row, the filter row (opens the form) or a form field; the
wheel scrolls the list and the details. A click outside the form or help closes it.

## Layout

Below 40×10 the TUI shows `Terminal too small: need 40×10, have W×H`. Below 60
columns it shows one column (the details replace the list, `Esc Back` returns);
from 60 columns the list and the details stand side by side, 55/45. It follows
window resizes.

## Updates

The TUI follows SSE `/v1/changes`. The header shows `● Live` or `○ Offline` with
the reason; it reconnects every 2 s. After a change it rereads the current section
(up to 200 rows, keeping the selected row) and the other loaded sections when they
are opened; `r` rereads by hand.

## Open

"Open" works only inside Herdr (`HERDR_ENV=1`, set in every Herdr pane): outside
Herdr it shows a message and changes nothing. It runs
`mise exec -- node dist/src/cli/main.js open <KEY>` in the engine root, with the
TUI's environment, so it uses the same database and the same Herdr. The engine root
is two levels above the binary's directory (`<engine>/tui/bin/mypi-tui`); `MYPI_ENGINE_ROOT`
overrides it. Clone progress and the result (`FX-1: started (claude)`, errors)
appear in the status line.

## Schema tolerance

The TUI checks `apiVersion: 1` in every response and shows other versions as an
error instead of guessing. Records are kept as JSON objects: unknown fields appear
under "Other fields", unknown event kinds and statuses in a neutral color, missing
fields as `—`.

## Development

`pnpm tui:check` runs `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`
and a dev build offline in the bounded unit `mypi-tui-check` (2 CPU, 1 GiB, 64
tasks, no network, read-only sources); `pnpm verify` runs it first, before the test
profile ([TESTING.md](TESTING.md) §6). `cargo test` covers the pure parts; the
terminal UI itself is accepted on the stand through Herdr. Rust is pinned in
`mise.toml` and `tui/rust-toolchain.toml`; change both together. CI installs that
toolchain with rustup, runs `scripts/tui.sh fetch`, then `scripts/ci.sh`.
