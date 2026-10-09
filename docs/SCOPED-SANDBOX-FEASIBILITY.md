# MP-6: retired product sandbox direction

The original MP-6 experiment, merged into `epic/scoped-sessions` through
[PR #9](https://github.com/yokeloop/mypi/pull/9), tested isolated Linux commands,
not a complete Pi session. Its implementation, feasibility report and validation
evidence remain in Git history and the MP-6 request artifacts.

The unused product executor and its sole dedicated boundary test have been
removed. The associated requirement for a mandatory sandbox and a custom trusted
SDK host is withdrawn. The scoped-session direction uses ordinary Pi and existing
extension APIs for cooperative project/worktree guardrails, not adversarial
containment or an OS security guarantee. Any future product isolation needs a
separately justified task; no optional sandbox backend is retained.

This removal intentionally reduces coverage only for the removed product feature.
The development test runner, including `scripts/test-sandbox.sh`, admission,
resource limits and unrelated tests, is unchanged. Test isolation remains required
by [the testing policy](TESTING.md); it is separate from product execution.
