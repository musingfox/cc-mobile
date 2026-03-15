# ADR-006: Load Plugins and Skills from User Settings

## Status
Accepted

## Context
The Agent SDK does not automatically load installed plugins or marketplace skills. `settingSources: ["user"]` loads settings like permissions and hooks from `~/.claude/settings.json`, but plugins require explicit `plugins: SdkPluginConfig[]` option with local paths. Skills require `allowedTools: ["Skill"]` to be enabled.

Users expect claude-code-mobile to have the same capabilities as their local Claude Code — including all installed plugins, skills, and MCP servers.

## Decision
Session manager reads user settings at startup to discover and load plugins:

1. Read `~/.claude/settings.json` → extract `enabledPlugins` map
2. Read `~/.claude/plugins/installed_plugins.json` → extract `installPath` for each plugin
3. Cross-reference: only load plugins that are both installed AND enabled
4. Pass resulting paths as `plugins: [{ type: "local", path }]` to SDK session
5. Add `"Skill"` to `allowedTools` so skills provided by plugins are available

## Rationale
- SDK documentation explicitly states plugins must be passed via `plugins` option (not loaded from settingSources)
- SDK documentation states `allowedTools: ["Skill"]` is required for skills to work
- Reading from the same settings files Claude Code uses ensures parity
- Cross-referencing enabled vs installed prevents loading disabled plugins

## Alternatives Considered
- **Hardcode plugin paths**: fragile, breaks when plugins are updated or added
- **Wait for SDK to support auto-loading**: no indication this is planned; SDK design intentionally gives developers explicit control
- **MCP servers**: similar issue — `mcpServers` option exists but won't be addressed in this ADR (future work)
