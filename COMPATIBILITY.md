# DeepSeek Harness compatibility

## 0.1.7-rc.2

- Host service lookups through `ctx.get()` remain available for `agents`, `subagents`, `sessions`, `tools`, `agentPresets`, `llm`, and `webServer`. The existing guarded lookups are retained.
- The host `SessionStore.get(id)?.header.cwd`, `subagents.startContinuable`, `subagents.sendMessage`, and the `subagent/end` payload still match the plugin's adapter in the checked release source.
- The Web sidebar now exposes `sidebarRight.mounted` as an observable Session id. Its former private `mounted()` method is gone. Opening a tab immediately after `layout.selectPanel(null)` can run before the seat binds. The entry now waits for a mounted Session; on 0.1.6-alpha.2, which has no observable, it uses the previous next-tick retry.
- The workbench uses the mounted Session when available. This resolves ambiguous `retainedBy.mainView` snapshots after switching between retained conversations. Older clients keep the snapshot-based selection.

Release `v0.1.1-dsh017.1` packages this compatibility patch for GitHub installation. The `0.1.6-alpha.2` fallback remains in place, but was not retested against a running old host for this release.
