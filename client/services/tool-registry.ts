export type ToolDefinition = {
  name: string;
  icon: string; // Single emoji
  title: (input: Record<string, unknown>) => string; // Dynamic title
  minimal: boolean | ((input: Record<string, unknown>) => boolean); // Default display mode
};

const toolDefinitions: Record<string, ToolDefinition> = {
  Read: {
    name: "Read",
    icon: "📖",
    title: (input) => {
      if (typeof input.file_path === "string") {
        // Extract filename from path
        const parts = input.file_path.split("/");
        return parts[parts.length - 1] || input.file_path;
      }
      return "Read";
    },
    minimal: true,
  },
  Write: {
    name: "Write",
    icon: "📝",
    title: (input) => {
      if (typeof input.file_path === "string") {
        const parts = input.file_path.split("/");
        return parts[parts.length - 1] || input.file_path;
      }
      return "Write";
    },
    minimal: true,
  },
  Edit: {
    name: "Edit",
    icon: "✏️",
    title: (input) => {
      if (typeof input.file_path === "string") {
        const parts = input.file_path.split("/");
        return parts[parts.length - 1] || input.file_path;
      }
      return "Edit";
    },
    minimal: true,
  },
  Bash: {
    name: "Bash",
    icon: "⚙️",
    title: (input) => {
      // Use description if available, otherwise fall back to command
      if (typeof input.description === "string" && input.description.trim()) {
        return input.description;
      }
      if (typeof input.command === "string") {
        return input.command;
      }
      return "Bash";
    },
    minimal: true,
  },
  Glob: {
    name: "Glob",
    icon: "🔍",
    title: (input) => {
      if (typeof input.pattern === "string") {
        return input.pattern;
      }
      return "Glob";
    },
    minimal: true,
  },
  Grep: {
    name: "Grep",
    icon: "🔎",
    title: (input) => {
      if (typeof input.pattern === "string") {
        return `Search: ${input.pattern}`;
      }
      return "Grep";
    },
    minimal: true,
  },
};

export function getToolDefinition(toolName: string): ToolDefinition | undefined {
  return toolDefinitions[toolName];
}
