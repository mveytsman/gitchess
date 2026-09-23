import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("./public/", import.meta.url));

export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  root = defaultRoot,
): Promise<void> {
  const head = request.method === "HEAD";
  function reply(status: number, body: string): void {
    response.writeHead(status, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      ...(status === 405 ? { Allow: "GET, HEAD" } : {}),
    });
    response.end(head ? undefined : body);
  }
  if (request.method !== "GET" && !head) return reply(405, "Method not allowed\n");

  let path: string;
  try {
    path = decodeURIComponent((request.url ?? "/").split("?")[0]!);
  } catch {
    return reply(400, "Bad request\n");
  }
  if (!path.startsWith("/") || path.includes("\0") || path.includes("\\") || path.split("/").includes("..")) {
    return reply(404, "Not found\n");
  }
  // Only generated HTML, CSS and board images are public. Never serve the Git repository.
  const filePath = path.endsWith("/") ? `${path}index.html`
    : /\.[^/]+$/.test(path) ? path : `${path}/index.html`;
  const type = filePath.endsWith(".html") ? "text/html; charset=utf-8"
    : filePath.endsWith(".css") ? "text/css; charset=utf-8"
    : filePath.endsWith(".svg") ? "image/svg+xml" : undefined;
  const file = resolve(root, `.${filePath}`);
  if (!type || !file.startsWith(`${resolve(root)}${sep}`)) return reply(404, "Not found\n");
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "Content-Type": type,
      "Content-Length": body.length,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(head ? undefined : body);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return reply(404, "Not found\n");
    console.error("Static website:", error);
    reply(500, "Internal server error\n");
  }
}

export function createWebServer(root = defaultRoot) {
  return createServer((request, response) => { void serveStatic(request, response, root); });
}
