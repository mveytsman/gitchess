import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const GITCHESS_WEB_URL = "https://github.com/mveytsman/gitchess";

export function redirectToGitHub(
  _request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(302, {
    "Content-Length": "0",
    Location: GITCHESS_WEB_URL,
  });
  response.end();
}

export function createWebServer() {
  return createServer(redirectToGitHub);
}
