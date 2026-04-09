import { homedir } from "node:os";
import { resolve } from "node:path";

export type PermissionMode =
  | "default"
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "dontAsk"
  | "plan";

export interface ServerConfig {
  port: number;
  hostname: string;
  defaultCwd: string | null;
  permissionMode: PermissionMode;
  allowedRoots: string[] | null;
  basePath: string;
}

/**
 * Parses and validates base path from env var or argv.
 * @throws Error if path doesn't start with /, contains .., or ends with /
 */
export function parseBasePath(basePath: string | undefined): string {
  if (basePath === undefined || basePath === "") {
    return "";
  }

  if (!basePath.startsWith("/")) {
    throw new Error("BASE_PATH must start with /");
  }

  if (basePath.includes("..")) {
    throw new Error("BASE_PATH cannot contain ..");
  }

  if (basePath.endsWith("/")) {
    throw new Error("BASE_PATH cannot end with /");
  }

  return basePath;
}

export function parseServerConfig(argv: string[]): ServerConfig {
  const config: ServerConfig = {
    port: 3001,
    hostname: "0.0.0.0",
    defaultCwd: null,
    permissionMode: "default",
    allowedRoots: parseAllowedRoots(),
    basePath: parseBasePath(process.env.BASE_PATH),
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--port": {
        const portValue = argv[i + 1];
        const port = parseInt(portValue, 10);
        if (Number.isNaN(port)) {
          throw new Error("Port must be a valid number");
        }
        config.port = port;
        i++;
        break;
      }
      case "--hostname":
        config.hostname = argv[i + 1];
        i++;
        break;
      case "--default-cwd":
        config.defaultCwd = argv[i + 1];
        i++;
        break;
      case "--permission-mode": {
        const mode = argv[i + 1];
        const validModes = [
          "default",
          "acceptEdits",
          "auto",
          "bypassPermissions",
          "dontAsk",
          "plan",
        ];
        if (!validModes.includes(mode)) {
          throw new Error(`Invalid permission-mode: ${mode}. Allowed: ${validModes.join(", ")}`);
        }
        config.permissionMode = mode as PermissionMode;
        i++;
        break;
      }
    }
  }

  return config;
}

function expandPath(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return resolve(homedir(), p.slice(2));
  }
  return resolve(p);
}

function parseAllowedRoots(): string[] | null {
  const envVar = process.env.CC_MOBILE_ALLOWED_ROOTS;
  if (!envVar || envVar.trim() === "") {
    return null;
  }

  return envVar
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => expandPath(p));
}
