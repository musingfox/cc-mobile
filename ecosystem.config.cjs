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
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
