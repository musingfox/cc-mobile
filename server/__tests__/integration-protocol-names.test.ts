/**
 * integration-protocol-names.test.ts — static check on the live herdr e2e suites.
 *
 * `server/integration/herdr-*.e2e.test.ts` speak the WS protocol by hand and are
 * excluded from `bun test` (they need a running herdr daemon and the `claude`
 * binary, so they run only via `bun run test:herdr`). That means the #25 rename
 * could not be verified there by executing them.
 *
 * This closes the gap statically: every message name those files send or match
 * on must be a member of the current ClientMessage / ServerMessage union. That
 * catches both halves of the risk a `grep` for the old name cannot see — a
 * rename that was missed, and a name that never existed in the first place.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ClientMessage, ServerMessage } from "../protocol";

const integrationDir = join(import.meta.dir, "..", "integration");

function unionMembers(union: typeof ClientMessage | typeof ServerMessage): string[] {
  return union.options.map((option) => (option.shape.type as { value: string }).value as string);
}

const knownMessages = new Set([...unionMembers(ClientMessage), ...unionMembers(ServerMessage)]);

/**
 * Names that are not WS messages: `stream_chunk.chunk` carries raw claude
 * message objects, and the e2e suites match on their `type` too. Spelled out
 * rather than pattern-skipped so an unexpected addition still fails.
 */
const CHUNK_TYPES = new Set(["substring", "assistant"]);

/**
 * Server→client acks that `terminal-control.ts` writes with a bare `ws.send`
 * and that were never ServerMessage members — they were not members under their
 * old backend-prefixed names either, so this is a pre-existing validation gap
 * that #25 renamed but did not introduce or close. Listed explicitly so the gap is
 * visible here rather than silently tolerated; closing it means adding the two
 * schemas, which is a change in behaviour rather than a deletion.
 */
const UNVALIDATED_SERVER_FRAMES = new Set(["terminal_created", "terminal_teardown_result"]);

test("the unvalidated acks really are absent from the union (gap is still open)", () => {
  for (const name of UNVALIDATED_SERVER_FRAMES) {
    expect(knownMessages.has(name)).toBe(false);
  }
});

/** `type: "x"` in an outgoing payload, or `.type === "x"` in an assertion. */
const NAME_PATTERN = /(?:type:\s*|\.type\s*===\s*)"([a-z_]+)"/g;

const suiteFiles = readdirSync(integrationDir).filter((f) => f.endsWith(".e2e.test.ts"));

test("the integration suites exist to be checked", () => {
  expect(suiteFiles.length).toBeGreaterThan(0);
});

describe("live e2e suites speak only names the protocol still carries", () => {
  test.each(suiteFiles)("%s", (file) => {
    const source = readFileSync(join(integrationDir, file), "utf8");
    const names = new Set<string>();
    for (const match of source.matchAll(NAME_PATTERN)) {
      names.add(match[1]);
    }
    expect(names.size).toBeGreaterThan(0);

    const unknown = [...names].filter(
      (n) => !knownMessages.has(n) && !CHUNK_TYPES.has(n) && !UNVALIDATED_SERVER_FRAMES.has(n),
    );
    expect(unknown).toEqual([]);
  });
});
