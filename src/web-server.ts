import { createWebServer } from "./web.js";

const port = Number(process.env.GITCHESS_WEB_PORT ?? 8080);
const host = process.env.GITCHESS_WEB_HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("GITCHESS_WEB_PORT must be an integer between 1 and 65535");
}
if (!host) throw new Error("GITCHESS_WEB_HOST must not be empty");

const server = createWebServer();

server.on("error", (error: Error) => {
  console.error("Web server:", error.message);
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Web redirect listening on http://${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit());
  });
}
