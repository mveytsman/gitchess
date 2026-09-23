import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWebServer } from "./web.js";

const port = Number(process.env.GITCHESS_WEB_PORT ?? 8080);
const host = process.env.GITCHESS_WEB_HOST ?? "127.0.0.1";

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error("GITCHESS_WEB_PORT must be an integer between 0 and 65535");
}
if (!host) throw new Error("GITCHESS_WEB_HOST must not be empty");

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.env.GITCHESS_WEB_ROOT ?? `${root}/dist/public`);
const server = createWebServer(output);
const worker = new Worker(new URL("./game-site-worker.js", import.meta.url), {
  workerData: {
    repo: resolve(process.env.GITCHESS_REPO ?? `${root}/var/chess.git`),
    output,
    interval: 3000,
  },
});

let stopping = false;
function shutdown(code = 0): void {
  if (stopping) return;
  stopping = true;
  // A partial HTTP request must not keep Ctrl-C waiting indefinitely.
  const deadline = setTimeout(() => process.exit(code), 2000);
  deadline.unref();
  const closed = new Promise<void>((done) => server.close(() => done()));
  server.closeAllConnections();
  void Promise.all([closed, worker.terminate()]).then(() => {
    clearTimeout(deadline);
    process.exitCode = code;
  });
}
worker.on("error", (error) => {
  console.error("Game website worker:", error);
  shutdown(1);
});
server.on("error", (error: Error) => {
  console.error("Web server:", error.message);
  shutdown(1);
});
server.listen(port, host, () => {
  const address = server.address();
  console.log(`Website listening on http://${host}:${typeof address === "object" && address ? address.port : port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown());
}
