---
id: test-tier-by-dependency
status: accepted
scope:
  - "client/*.test.ts"
  - "client/*.test.tsx"
  - "client/**/*.test.ts"
  - "client/**/*.test.tsx"
  - "server/*.test.ts"
  - "server/**/*.test.ts"
  - "test/*.test.ts"
  - "tests/*.test.ts"
  - "tests/**/*.test.ts"
  - "bunfig.toml"
  - "package.json"
verify: check:bun test ./server/__tests__/test-tier-guard.test.ts
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
collects; `server/__tests__/test-tier-guard.test.ts` walks the files the commit
gate collects — Bun's own discovery rule minus those patterns — and asserts
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
`client/integration/pwa-build.test.ts`, out of the gate, and CI runs it as its
own step (`bun run test:build`), where `dist/` is disposable.

The guard is static, so each clause is checked in the form a scan can see. A
spawn is a call to `Bun.spawn`, the Bun shell, or an import of
`child_process`. A fixed port is a non-zero literal reaching `.listen(` or
`Bun.serve(` — directly, or through an in-file binding such as
`serverConfig.port` — or a `Bun.serve` that names no port at all and so takes
3000; grepping the bare call would be red on day one, because every bind in the
gate is `.listen(0)`. A write is a filesystem call whose path argument,
followed through in-file bindings and path-building calls, is rooted at a
string literal, `import.meta`, `__dirname`, `process.cwd()` or `homedir()`; or
a call into the upload functions without the root `server/upload-manager.ts`
takes, whose default is `~/.cache/cc-mobile/uploads`. That seam is what made the
write clause checkable: before it, every test exercising `createUploadPlugin`
wrote into the home cache and the check would have been red with no way to
comply.

What the scan cannot see stays a rule the reader holds, not a receipt: a path
that arrives through a function parameter or from a helper module (imported,
not collected — `ws-harness.ts` and `app-gate-harness.ts` both bind
`.listen(0)` today), and a production default under the home directory that the
guard's list does not name. The guard went red on the files it was written
against, planted back into collected paths: the old `server/static.test.ts`
writing `<repo>/test-dist`, the old upload tests writing the home cache, and
TC13.
