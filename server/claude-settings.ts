/**
 * claude-settings.ts — the single source of truth for the `--settings` file that
 * cc-mobile injects into every claude session it launches.
 *
 * Backend-neutral on purpose: the hook shape (Stop → pty-response, PreToolUse →
 * pty-permission) is one contract, not one per terminal backend. Extracted
 * verbatim from the retired terminal adapter (#25) so deleting that adapter
 * could not take the herdr registry's hook wiring with it.
 */

export interface BuildClaudeSettingsInput {
  responseUrl: string;
  stopHookPath: string;
  permissionUrl?: string;
  permissionHookPath?: string;
}

/**
 * Generates the ~/.claude/settings.json (or --settings file) shape that wires
 * the Stop and PreToolUse hooks using the CC_MOBILE_*_URL env + bun <hook> shape.
 *
 * Throws if responseUrl is falsy (per T3).
 */
export function buildClaudeSettings(input: BuildClaudeSettingsInput): {
  hooks: {
    Stop: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
    PreToolUse?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>;
  };
} {
  if (!input.responseUrl || input.responseUrl.trim() === "") {
    throw new Error("responseUrl is required and must be non-empty");
  }

  const stopCommand = `CC_MOBILE_RESPONSE_URL='${input.responseUrl}' bun '${input.stopHookPath}'`;

  const result: any = {
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: stopCommand,
            },
          ],
        },
      ],
    },
  };

  // PreToolUse gate: only the tools claude's default mode would prompt for.
  // Read-class tools (Read/Glob/Grep) stay out so a 90s unattended deny cannot
  // stall a whole turn of lookups (plan D1). Injected only when both permission
  // inputs are present (plan D5) — production registries always pass both.
  if (input.permissionUrl && input.permissionHookPath) {
    const permissionCommand = `CC_MOBILE_PERMISSION_URL='${input.permissionUrl}' bun '${input.permissionHookPath}'`;
    result.hooks.PreToolUse = [
      {
        matcher: "Bash|Write|Edit|NotebookEdit",
        hooks: [
          {
            type: "command",
            command: permissionCommand,
          },
        ],
      },
    ];
  }

  return result;
}
