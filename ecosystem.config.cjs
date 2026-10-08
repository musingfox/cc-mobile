const { readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join } = require("node:path");

// The launch token is a secret, so it lives in a 0600 file outside the repo;
// a missing file leaves it unset and /api/launch answers 503.
function readLaunchToken() {
  try {
    return readFileSync(join(homedir(), ".claude-mobile", "launch-token"), "utf8").trim();
  } catch {
    return "";
  }
}

module.exports = {
  apps: [
    {
      name: "cc-mobile-server",
      script: "server/index.ts",
      interpreter: "bun",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "cc-mobile-client",
      script: "node_modules/.bin/vite",
      args: "--host",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
      },
    },
    {
      name: "cc-mobile-prod",
      script: "server/index.ts",
      interpreter: "bun",
      // Loopback only: the phone reaches this through `tailscale serve`, which
      // terminates TLS for the tailnet and proxies to localhost. Binding the
      // LAN interface as well would leave a plain-http door open on the same
      // machine — and that door is not a secure context, so a browser there
      // gets no service worker, no push, and no crypto.randomUUID.
      args: "--port 7701 --hostname 127.0.0.1",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        CC_MOBILE_HANGAR_SESSION: "fleet",
        CC_MOBILE_VAULT_ROOT: join(homedir(), "Documents", "obsidian"),
        CC_MOBILE_LAUNCH_TOKEN: readLaunchToken(),
      },
    },
  ],
};
