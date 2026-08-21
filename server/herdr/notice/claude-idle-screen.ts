/**
 * claude-idle-screen.ts — ClaudeAttentionScreenClassifier.
 *
 * herdr reports claude's first-run workspace-trust dialog as `idle`, not
 * `blocked`. The phone needs to tell that screen apart from a composer that
 * is simply waiting. Markers are the two stable lines from the live capture
 * in fixtures/trust-dialog.txt — a shape nobody captured does not get a
 * pattern.
 */

/**
 * Captured live (probe 2026-08-02), fixtures/trust-dialog.txt:
 *
 *     Accessing workspace:
 *
 *     /private/tmp/cf-0802-JmBO/probe/cwd
 *
 *     Quick safety check: Is this a project you created or one you trust?
 */
const ACCESSING_WORKSPACE = "Accessing workspace:";

/**
 * Same capture, the question the dialog actually asks. Either marker is
 * enough: a partial `pane.read` may keep one line and drop the other.
 */
const QUICK_SAFETY_CHECK = "Quick safety check";

export function isClaudeAttentionScreen(screen: string): boolean {
  return screen.includes(ACCESSING_WORKSPACE) || screen.includes(QUICK_SAFETY_CHECK);
}
