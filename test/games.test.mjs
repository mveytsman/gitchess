import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { GitRepository } from "../dist/git.js";
import { gameUpdate } from "../dist/games.js";

test("game pushes create symbolic aliases, update from either player, and enforce ownership", () => {
  const dir = mkdtempSync(`${tmpdir()}/chesshub-games-`);
  const repo = `${dir}/repo.git`, client = `${dir}/client`;
  const run = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  run("init", "--bare", repo);
  run("init", client);
  run("-C", client, "config", "user.name", "Test");
  run("-C", client, "config", "user.email", "test@example.com");
  const git = new GitRepository(repo);
  const key = git.writeBlob("test key");
  git.transaction(["alice", "bob", "eve", "_chessbot"].map(name => ({ kind: "create", ref: `refs/users/${name}`, oid: key })));
  for (const name of ["pre-receive", "proc-receive"]) {
    const hook = fileURLToPath(new URL(`../dist/hooks/${name}.js`, import.meta.url));
    writeFileSync(`${repo}/hooks/${name}`, `#!/bin/sh\nexec '${process.execPath}' '${hook}'\n`, { mode: 0o755 });
  }
  run("--git-dir", repo, "config", "receive.procReceiveRefs", "am:refs/heads/games/");
  run("--git-dir", repo, "config", "receive.denyDeletes", "true");
  const commit = () => {
    run("-C", client, "commit", "--allow-empty", "-m", "move");
    return run("-C", client, "rev-parse", "HEAD");
  };
  const push = (player, ...refs) => spawnSync("git", ["-C", client, "push", repo, ...refs], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, CHESSHUB_PLAYER: player },
  });
  const alice = "refs/heads/games/alice/bob/demo";
  const bob = "refs/heads/games/bob/alice/demo";
  const canonical = "refs/heads/canonical/alice/bob/demo";
  const first = commit();
  let result = push("alice", `HEAD:${alice}`);
  assert.equal(result.status, 0, result.stderr);
  for (const alias of [alice, bob]) assert.equal(git.readSymbolicRef(alias), canonical);
  assert.equal(run("--git-dir", repo, "rev-parse", canonical), first);
  const second = commit();
  result = push("bob", `HEAD:${bob}`);
  assert.equal(result.status, 0, result.stderr);
  for (const ref of [alice, bob, canonical]) assert.equal(run("--git-dir", repo, "rev-parse", ref), second);
  assert.throws(() => git.transaction(gameUpdate(git, alice, first, second, "alice")));
  commit();
  for (const [player, ref] of [
    ["eve", alice], ["", alice], ["alice", bob], ["alice", canonical],
    ["alice", "refs/heads/main"], ["alice", "refs/heads/games/alice/bob"],
    ["alice", "refs/heads/games/alice/missing/demo"], ["alice", "refs/heads/games/alice/alice/demo"],
  ]) {
    result = push(player, `HEAD:${ref}`);
    assert.notEqual(result.status, 0, `${player} must not write ${ref}`);
  }
  result = push("alice", `:${alice}`);
  assert.notEqual(result.status, 0);
  assert.equal(git.readSymbolicRef(alice), canonical);
  // One bad game prevents the other game's refs from being created.
  result = push("alice", "HEAD:refs/heads/games/alice/bob/new", "HEAD:refs/heads/games/alice/missing/new");
  assert.notEqual(result.status, 0);
  assert.equal(git.hasRef("refs/heads/canonical/alice/bob/new"), false);
  assert.equal(git.hasRef("refs/heads/games/alice/bob/new"), false);
  assert.equal(run("--git-dir", repo, "rev-parse", canonical), second);
  result = push("alice", "HEAD:refs/heads/games/alice/_chessbot/bot-game");
  assert.equal(result.status, 0, result.stderr);
  commit();
  result = push("_chessbot", "HEAD:refs/heads/games/_chessbot/alice/bot-game");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git.readSymbolicRef("refs/heads/games/alice/_chessbot/bot-game"),
    "refs/heads/canonical/_chessbot/alice/bot-game");
});
