# HTTP API and the TUI

Read when: starting or exposing mypi serve, handling API tokens, or changing an HTTP route or the TUI.

## HTTP API

- `mypi serve` ([docs/HTTP-API.md](../HTTP-API.md)) is an optional foreground HTTP API over the
  same application commands; start it, expose it with `--listen` or install
  its systemd unit only on the user's request. Server-side token hashes live
  only in `$XDG_CONFIG_HOME/mypi/api-tokens.json`; a client's token value only in
  `MYPI_API_TOKEN` or the private 0600 file `$XDG_CONFIG_HOME/mypi/tui-token`
  ([docs/TUI.md](../TUI.md)), never in home, a repository or a prompt; never print a token value except the one `mypi token create` returns.
- [docs/HTTP-API.md](../HTTP-API.md) owns the API contract: a route or response change updates it
  in the same change, and a breaking change needs a new /v<N>.
