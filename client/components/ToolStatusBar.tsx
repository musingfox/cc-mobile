interface ToolStatusBarProps {
  activeToolStatus: { toolName: string; description: string } | null | undefined;
}

export function ToolStatusBar({ activeToolStatus }: ToolStatusBarProps) {
  if (!activeToolStatus) return null;
  return (
    <div className="tool-status-bar">
      {activeToolStatus.toolName}: {activeToolStatus.description}...
    </div>
  );
}
