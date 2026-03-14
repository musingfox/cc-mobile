import type { Capabilities } from "../hooks/useSocket";

type QuickActionsProps = {
  capabilities: Capabilities | null;
  onCommand: (command: string) => void;
  disabled: boolean;
};

export default function QuickActions({
  capabilities,
  onCommand,
  disabled,
}: QuickActionsProps) {
  if (!capabilities) return null;

  const { commands, agents } = capabilities;
  if (commands.length === 0 && agents.length === 0) return null;

  return (
    <div className="quick-actions">
      {commands.length > 0 && (
        <div className="quick-actions-row">
          {commands.map((cmd) => (
            <button
              key={cmd}
              className="quick-action-btn command"
              onClick={() => onCommand(`/${cmd}`)}
              disabled={disabled}
            >
              /{cmd}
            </button>
          ))}
        </div>
      )}
      {agents.length > 0 && (
        <div className="quick-actions-row">
          {agents.map((agent) => (
            <button
              key={agent}
              className="quick-action-btn agent"
              onClick={() => onCommand(`@${agent}`)}
              disabled={disabled}
            >
              @{agent}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
