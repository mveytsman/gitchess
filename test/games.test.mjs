import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { GitRepository } from "../dist/git.js";

test("game actions create games and validated server-generated positions", () => {
  const dir = mkdtempSync(`${tmpdir()}/gitchess-games-`);
  const repo = `${dir}/repo.git`, client = `${dir}/client`;
  const run = (...args) => execFileSync("git", args, {
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  run("init", "--bare", repo);
  run("init", client);
  run("-C", client, "config", "user.name", "Test");
  run("-C", client, "config", "user.email", "test@example.com");
  const commandPath = fileURLToPath(new URL("../repository/git-chess", import.meta.url));
  copyFileSync(commandPath, `${client}/git-chess`);
  chmodSync(`${client}/git-chess`, 0o755);
  run("-C", client, "add", "git-chess");
  run("-C", client, "commit", "-m", "client anchor");
  const git = new GitRepository(repo);
  const key = git.writeBlob("test key");
  const readme = git.writeBlob("# gitchess\n");
  const command = git.writeBlob(readFileSync(commandPath));
  const main = git.createCommit(git.writeTree([
    { name: "README.md", oid: readme },
    { name: "git-chess", oid: command, mode: "100755" },
  ]), [], "Welcome", "alice");
  git.transaction(["alice", "bob", "eve", "_chessbot"].map(name =>
    ({ kind: "create", ref: `refs/users/${name}`, oid: key })).concat([
      { kind: "create", ref: "refs/heads/main", oid: main },
    ]));
  for (const name of ["pre-receive", "proc-receive"]) {
    const hook = fileURLToPath(new URL(`../dist/hooks/${name}.js`, import.meta.url));
    writeFileSync(`${repo}/hooks/${name}`, `#!/bin/sh\nexec '${process.execPath}' '${hook}'\n`, { mode: 0o755 });
  }
  run("--git-dir", repo, "config", "receive.procReceiveRefs", "a:refs/new-game");
  run("--git-dir", repo, "config", "--add", "receive.procReceiveRefs", "a:refs/moves");
  run("--git-dir", repo, "config", "receive.advertisePushOptions", "true");
  run("--git-dir", repo, "config", "receive.denyDeletes", "true");
  run("--git-dir", repo, "config", "receive.hideRefs", "refs/");
  run("--git-dir", repo, "config", "--add", "receive.hideRefs", "!refs/new-game");
  run("--git-dir", repo, "config", "--add", "receive.hideRefs", "!refs/moves");
  run("-C", client, "remote", "add", "origin", repo);

  const installed = execFileSync(`${client}/git-chess`, ["install"], {
    cwd: client, encoding: "utf8",
  });
  assert.match(installed, /Installed: use git chess/);
  assert.equal(run("-C", client, "config", "--get", "alias.chess"), "!./git-chess");

  const push = (player, destination, options = []) => spawnSync(
    "git",
    ["-C", client, "push", ...options.flatMap(option => ["-o", option]), repo, `HEAD:${destination}`],
    {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, GITCHESS_PLAYER: player },
    },
  );
  const chess = (player, ...args) => spawnSync(
    "git",
    ["-C", client, "chess", ...args],
    {
      encoding: "utf8", timeout: 10000,
      env: { ...process.env, GITCHESS_PLAYER: player },
    },
  );
  const oid = ref => run("--git-dir", repo, "rev-parse", ref);
  const sync = ref => {
    run("-C", client, "fetch", repo, ref);
    run("-C", client, "checkout", "-B", "game", "FETCH_HEAD");
  };

  const players = chess("alice", "players");
  assert.equal(players.status, 0, players.stderr);
  assert.deepEqual(players.stdout.trim().split("\n"), ["_chessbot", "alice", "bob", "eve"]);

  let result = chess("alice", "challenge", "bob", "--black");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /gitchess: created games\/alice\/bob\/[a-f0-9]{16}/);
  const canonical = run(
    "--git-dir", repo, "for-each-ref", "--format=%(refname)", "refs/heads/canonical",
  );
  const match = /^refs\/heads\/canonical\/bob\/alice\/([a-f0-9]{16})$/.exec(canonical);
  assert.ok(match, canonical);
  const id = match[1];
  const alice = `refs/heads/games/alice/bob/${id}`;
  const bob = `refs/heads/games/bob/alice/${id}`;
  const initial = oid(canonical);
  assert.equal(run("-C", client, "branch", "--show-current"), `games/alice/bob/${id}`);
  assert.equal(git.hasRef("refs/new-game"), false);
  assert.equal(git.readCommit(initial).parents.length, 0);
  assert.equal(git.readCommit(initial).author, "alice");
  assert.equal(
    git.readCommit(initial).message,
    `Start game ${id}\n\nalice challenged bob and chose Black.\n`,
  );
  for (const alias of [alice, bob]) assert.equal(git.readSymbolicRef(alias), canonical);
  assert.equal(git.readFile(initial, "position.fen").toString(),
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1\n");
  assert.equal(git.readFile(initial, "README.md").toString(), "# gitchess\n");
  assert.equal(oid(`${initial}:README.md`), oid("refs/heads/main:README.md"));
  assert.equal(oid(`${initial}:git-chess`), oid("refs/heads/main:git-chess"));
  assert.match(run("--git-dir", repo, "ls-tree", initial, "git-chess"), /^100755 blob /);
  const svg = git.readFile(initial, "position.svg").toString();
  assert.match(svg, /^<svg /);
  assert.match(svg, /Chessnut pieces by Alexis Luengas/);
  assert.match(svg, /data:image\/svg\+xml;base64,/);
  const png = git.readFile(initial, "position.png");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);

  result = push("alice", "refs/moves", ["move=e4"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /It is bob's turn/);
  assert.equal(oid(canonical), initial);

  result = push("bob", "refs/moves", ["move=e4"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git.hasRef("refs/moves"), false);
  const state1 = oid(canonical);
  assert.equal(run("--git-dir", repo, "rev-parse", `${state1}^`), initial);
  assert.equal(git.readCommit(state1).author, "bob");
  assert.equal(git.readCommit(state1).message, "e4\n");
  assert.equal(oid(`${state1}:README.md`), oid(`${initial}:README.md`));
  assert.equal(git.readFile(state1, "position.fen").toString(),
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1\n");
  assert.notEqual(oid(`${state1}:position.svg`), oid(`${initial}:position.svg`));
  assert.notEqual(oid(`${state1}:position.png`), oid(`${initial}:position.png`));

  result = push("alice", "refs/moves", ["move=e5"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No current game has that position/);
  result = chess("alice", "move", "e5");
  assert.equal(result.status, 0, result.stderr);
  const state2 = oid(canonical);
  assert.equal(run("-C", client, "rev-parse", "HEAD"), state2);
  assert.equal(git.readCommit(state2).author, "alice");
  assert.equal(oid(`${state2}:README.md`), oid(`${initial}:README.md`));
  assert.equal(oid(`${state2}:git-chess`), oid(`${initial}:git-chess`));
  assert.equal(git.readFile(state2, "position.fen").toString(),
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2\n");

  sync(bob);
  for (const [player, destination, options, error] of [
    ["eve", "refs/moves", ["move=Nf3"], /not a player/],
    ["bob", "refs/moves", ["move=e5"], /Illegal move/],
    ["bob", "refs/moves", [], /Missing push option: move/],
    ["bob", "refs/moves", ["move=Nf3", "color=white"], /Unsupported push option/],
    ["alice", "refs/new-game", ["opponent=bob"], /Missing push option: color/],
    ["alice", "refs/new-game", ["opponent=nobody", "color=white"], /Unknown player/],
    ["alice", "refs/heads/main", [], /Push game actions|fetch first|hidden ref/],
  ]) {
    result = push(player, destination, options);
    assert.notEqual(result.status, 0, `${player} must not update ${destination}`);
    assert.match(result.stderr, error);
    assert.equal(oid(canonical), state2);
  }
});
