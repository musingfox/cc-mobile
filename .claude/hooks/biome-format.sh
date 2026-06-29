#!/usr/bin/env bash
# PostToolUse formatter for Edit|Write.
#
# Fail-closed by design: when in doubt, SKIP formatting rather than risk
# corrupting the file. `biome check --write` partial-applies formatting even
# when it reports parse errors — on a half-resolved merge/cherry-pick conflict
# it mangles docstrings (a `* text` line with no `/**` gets reformatted into
# bogus JS statements). Worse, the damage is often syntactically valid, so
# tsc/tests don't catch it and it lands in a commit. So we gate biome behind
# cheap guards and never let it touch a conflicted file.
#
# Run `biome-format.sh --selftest` to verify the guards still hold.

run_format() {
	f="$1"
	[ -z "$f" ] && return 0          # no target (empty var) → don't fan out to whole repo
	[ -f "$f" ] || return 0          # deleted/renamed/dir → nothing to format
	# Git conflict markers, incl. diff3 base marker `|||||||`. Only matches 7
	# leading conflict chars, so `===` / `>>>` operators are never tripped.
	grep -qE '^(<{7}|={7}|>{7}|\|{7})' "$f" && return 0
	bunx biome check --write "$f" 2>&1
	return 0
}

selftest() {
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' EXIT
	fail=0

	# 1. conflict file → must be left byte-for-byte untouched
	printf '/**\n=======\n * already been surfaced, suppress the re-emit\n */\n' >"$tmp/conf.ts"
	before="$(cat "$tmp/conf.ts")"
	run_format "$tmp/conf.ts" >/dev/null 2>&1
	[ "$before" = "$(cat "$tmp/conf.ts")" ] || { echo "FAIL: conflict file was modified"; fail=1; }

	# 2. empty var → must not error / must not format the repo
	run_format "" >/dev/null 2>&1 || { echo "FAIL: empty arg errored"; fail=1; }

	# 3. missing file → must not error
	run_format "$tmp/nope.ts" >/dev/null 2>&1 || { echo "FAIL: missing file errored"; fail=1; }

	# 4. operators === and >>> at non-line-start must NOT be seen as conflicts
	printf 'export const a = (x === y);\nconst b = a >>> 2;\n' >"$tmp/ok.ts"
	if grep -qE '^(<{7}|={7}|>{7}|\|{7})' "$tmp/ok.ts"; then echo "FAIL: operators tripped guard"; fail=1; fi

	[ "$fail" = 0 ] && echo "selftest: all guards hold"
	return "$fail"
}

if [ "$1" = "--selftest" ]; then
	selftest
	exit $?
fi

run_format "$CLAUDE_TOOL_ARG_file_path"
exit 0
