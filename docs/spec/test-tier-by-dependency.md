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
writes outside its sandbox can change what a live server serves —
`client/__tests__/pwa.test.ts`'s TC13 spawns `bun run build` and rewrites
`dist/client`, which is `server/app.ts:44`'s `DIST_DIR` and what pm2's
`cc-mobile-prod` is serving; each rebuild re-stamps `sw.js`'s `CACHE_NAME`, so
running the commit gate makes the phone's PWA purge its cache. No assertion in
that file mentions any of it.

`verify` stays null until the tiering lands: the guard check would be red on
day one, because TC13 is in the unit tier today and is the reason this entry
exists. A check that is red on arrival would be a wrong check, not wrong code.
When TC13 moves and the guard test exists, this becomes `test:` pointing at it.
