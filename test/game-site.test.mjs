import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "node:net";
import test from "node:test";
import { Chess } from "chess.js";
import { GitRepository } from "../dist/git.js";
import { GameSite } from "../dist/website/games.js";
import { buildSite } from "../dist/website/layout.js";

const source = fileURLToPath(new URL("../src/website/", import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "gitchess-game-site-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "chess.git"), output = join(dir, "public");
  buildSite(source, output);
  return { dir, repo, output, site: new GameSite(repo, output) };
}
function init(repo) {
  execFileSync("git", ["init", "--bare", repo], { stdio: "pipe" });
  return new GitRepository(repo);
}
function commit(git, chess, parent, message, author) {
  const tree = git.writeTree([
    { name: "position.fen", oid: git.writeBlob(chess.fen() + "\n") },
    { name: "position.svg", oid: git.writeBlob('<svg xmlns="http://www.w3.org/2000/svg"><text>' + message + '</text></svg>') },
  ]);
  return git.createCommit(tree, parent ? [parent] : [], message, author);
}

test("publishes real branches, boards, move history and terminal status; refreshes changed tips", (t) => {
  const { repo, output, site } = fixture(t);
  const git = init(repo);
  const chess = new Chess();
  const ref = "refs/heads/games/alice/bob/0123456789abcdef";
  let oid = commit(git, chess, undefined, "Start game", "alice");
  git.transaction([{ kind: "create", ref, oid }]);
  assert.equal(site.refresh(), true);
  const pagePath = join(output, "games/0123456789abcdef/index.html");
  assert.match(readFileSync(pagePath, "utf8"), /No moves yet/);
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /White to move/);
  assert.equal(site.refresh(), false);
  for (const san of ["f3", "e5", "g4", "Qh4#"]) {
    const author = chess.turn() === "w" ? "alice" : "bob";
    chess.move(san);
    const oldOid = oid;
    oid = commit(git, chess, oid, san, author);
    git.transaction([{ kind: "update", ref, oid, oldOid }]);
  }
  assert.equal(site.refresh(), true);
  const page = readFileSync(pagePath, "utf8");
  assert.match(page, /0–1 · Checkmate/);
  assert.match(page, /2… Qh4#/);
  assert.match(page, new RegExp(oid + "\\.svg"));
  assert.match(readFileSync(join(output, `games/0123456789abcdef/${oid}.svg`), "utf8"), /Qh4#/);
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /0–1 · Checkmate/);
  buildSite(source, output);
  assert.equal(site.refresh(), true);
  assert.match(readFileSync(pagePath, "utf8"), /Qh4#/);
  execFileSync("git", ["--git-dir", repo, "update-ref", "-d", ref]);
  site.refresh();
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /No games yet/);
  assert.throws(() => readFileSync(pagePath), /ENOENT/);
});

test("distinguishes an unavailable repository from an empty one and recovers", (t) => {
  const { repo, output, site } = fixture(t);
  site.refresh();
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /not available/);
  init(repo);
  site.refresh();
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /No games yet/);
  buildSite(source, output);
  site.refresh();
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /No games yet/);
});

test("uses history to recognize repetition draws", (t) => {
  const { repo, output, site } = fixture(t);
  const git = init(repo), chess = new Chess();
  let oid = commit(git, chess, undefined, "Start game", "alice");
  for (const san of ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"]) {
    const author = chess.turn() === "w" ? "alice" : "bob";
    chess.move(san);
    oid = commit(git, chess, oid, san, author);
  }
  git.transaction([{ kind: "create", ref: "refs/heads/games/alice/bob/0123456789abcdef", oid }]);
  site.refresh();
  assert.match(readFileSync(join(output, "games/index.html"), "utf8"), /Threefold repetition/);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  test(`HTTP server stops on ${signal} with an incomplete request and active refresh worker`, { timeout: 10000 }, async (t) => {
    const { repo, output } = fixture(t);
    const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/website/server.js", import.meta.url))], {
      env: { ...process.env, GITCHESS_WEB_PORT: "0", GITCHESS_WEB_HOST: "127.0.0.1", GITCHESS_REPO: repo, GITCHESS_WEB_ROOT: output },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill("SIGKILL"));
    let stderr = "";
    child.stderr.on("data", (chunk) => stderr += chunk);
    const exit = once(child, "exit");
    const port = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Exited ${code}: ${stderr}`)));
      child.stdout.on("data", (chunk) => {
        const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(chunk.toString());
        if (match) resolve(Number(match[1]));
      });
    });
    const socket = connect(port, "127.0.0.1");
    t.after(() => socket.destroy());
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
    child.kill(signal);
    assert.deepEqual(await exit, [0, null]);
  });
}
