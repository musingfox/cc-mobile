export type PermissionOption = {
  id: string;
  label: string;
  color: "green" | "blue" | "red";
  action: "approve" | "approve_session" | "deny";
};

function truncateCommand(cmd: string, maxLength = 40): string {
  if (cmd.length <= maxLength) return cmd;
  return `${cmd.slice(0, maxLength)}...`;
}

export function getPermissionOptions(
  toolName: string,
  parameters: Record<string, unknown>,
): PermissionOption[] {
  const baseOptions: PermissionOption[] = [];

  // Approve option (always present)
  baseOptions.push({
    id: "yes",
    label: "Yes",
    color: "green",
    action: "approve",
  });

  // Session-level approve option (tool-specific)
  if (toolName === "Edit") {
    baseOptions.push({
      id: "all-edits",
      label: "Yes, allow all edits",
      color: "blue",
      action: "approve_session",
    });
  } else if (toolName === "Bash" && parameters.command) {
    const command = parameters.command as string;
    const truncated = truncateCommand(command);
    baseOptions.push({
      id: "allow-cmd",
      label: `Yes, allow \`${truncated}\` for session`,
      color: "blue",
      action: "approve_session",
    });
  } else {
    baseOptions.push({
      id: "allow-tool",
      label: `Yes, allow ${toolName}`,
      color: "blue",
      action: "approve_session",
    });
  }

  // Deny option (always present)
  baseOptions.push({
    id: "no",
    label: "No",
    color: "red",
    action: "deny",
  });

  return baseOptions;
}
