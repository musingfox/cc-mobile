---
id: test-tier-by-dependency
status: accepted
scope:
  - "client/**/*.test.ts"
  - "client/**/*.test.tsx"
  - "server/**/*.test.ts"
  - "tests/**/*.test.ts"
  - "bunfig.toml"
  - "package.json"
verify: null
related: []
source: null
adr: null
---

A test's tier is decided by what it depends on, never by where the file sits.
A **unit** test may not spawn a process, bind a fixed port, or write anywhere
outside `tmpdir()`. An **integration** test may stand up an in-process server
on an ephemeral port and use a filesystem sandbox it creates and removes. An
**e2e** test is one that needs something the repo cannot start — an external
daemon or an agent binary on `PATH` — and it never runs in the commit gate.

Tier membership is enforced in two places that must agree. `bunfig.toml`'s
`pathIgnorePatterns` and `package.json`'s test scripts decide what each command
collects; a guard test walks the files the commit gate collects and asserts
zero hits for the forbidden dependencies, the way
`server/__tests__/dead-code-residue.test.ts` walks `server/` and `client/` and
asserts zero hits for deleted paths.

An in-process WebSocket harness on an ephemeral port stays a unit test — the
line is a *fixed* port, not a socket, and about eleven files rely on this.
Reading the real `homedir()` is likewise fine when the value appears on both
sides of the assertion, because nothing about the machine is then being
asserted.

A mis-tiered test fails silently in the only sense that matters: it passes on
an idle machine and fails as a flake on a busy one, so the tier error is read
as test noise and the test is re-run rather than moved. Worse, a test that
writes outside its sandbox can change what a live server serves — TC13 spawns
`bun run build` and rewrites `dist/client`, which is `server/app.ts:44`'s
`DIST_DIR` and what pm2's `cc-mobile-prod` is serving; each rebuild re-stamps
`sw.js`'s `CACHE_NAME`, so every commit made the phone's PWA purge its cache.
No assertion in that test mentions any of it. It now lives in
`client/integration/pwa-build.test.ts`, out of the gate.

`verify` stays null because a check today could cover only two of the three
clauses. Spawn is greppable and green now that TC13 has moved. The port clause
is greppable only as a non-zero literal argument to `.listen(` or `Bun.serve(`
— every bind in the collected tests is `.listen(0)`, so grepping the bare call
would be red on day one. The write clause has no robust static form and is red
regardless: every test exercising `createUploadPlugin` writes into
`~/.cache/cc-mobile/uploads`, because `server/upload-manager.ts:7` hardcodes
`homedir()` with no injectable root. A check asserting two clauses while the
spec claims three is a false receipt, so this becomes `test:` when the write
clause has both a sandbox seam and a check that does not need one.
