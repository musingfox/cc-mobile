export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

export interface ServerConfig {
  port: number;
  hostname: string;
  defaultCwd: string | null;
  permissionMode: PermissionMode;
}

export function parseServerConfig(argv: string[]): ServerConfig {
  const config: ServerConfig = {
    port: 3001,
    hostname: "0.0.0.0",
    defaultCwd: null,
    permissionMode: "default",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--port":
        const portValue = argv[i + 1];
        const port = parseInt(portValue, 10);
        if (isNaN(port)) {
          throw new Error("Port must be a valid number");
        }
        config.port = port;
        i++;
        break;
      case "--hostname":
        config.hostname = argv[i + 1];
        i++;
        break;
      case "--default-cwd":
        config.defaultCwd = argv[i + 1];
        i++;
        break;
      case "--permission-mode":
        const mode = argv[i + 1];
        if (mode !== "default" && mode !== "acceptEdits" && mode !== "bypassPermissions") {
          throw new Error(`Invalid permission-mode: ${mode}. Allowed: default, acceptEdits, bypassPermissions`);
        }
        config.permissionMode = mode;
        i++;
        break;
    }
  }

  return config;
}
