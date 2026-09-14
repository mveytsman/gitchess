import assert from "node:assert/strict";
import test from "node:test";

import { GITCHESS_WEB_URL, redirectToGitHub } from "../dist/web.js";

test("every web request redirects to the gitchess GitHub repository", () => {
  for (const request of [
    { method: "GET", url: "/" },
    { method: "GET", url: "/games/alice/bob" },
    { method: "POST", url: "/anything" },
  ]) {
    let status;
    let headers;
    let ended = false;
    const response = {
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus;
        headers = nextHeaders;
      },
      end() {
        ended = true;
      },
    };

    redirectToGitHub(request, response);

    assert.equal(status, 302);
    assert.deepEqual(headers, {
      "Content-Length": "0",
      Location: GITCHESS_WEB_URL,
    });
    assert.equal(ended, true);
  }
});
