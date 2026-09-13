import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { GitCommandError, GitRepository } from "../dist/git.js";

function finishTransport(child) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end("0000");
  });
}

test("transport processes stream Git advertisements and use only the requested protocol", async () => {
  const { git, inspect } = fixture();
  const key = git.writeBlob("public key");
  const tree = git.writeTree([]);
  const main = git.createCommit(tree, [], "Welcome", "alice");
  const aliceGame = git.createCommit(tree, [], "Alice's game", "alice");
  const bobGame = git.createCommit(tree, [], "Bob's game", "bob");
  git.transaction([
    { kind: "create", ref: "refs/heads/main", oid: main },
    { kind: "create", ref: "refs/users/alice", oid: key },
    { kind: "create", ref: "refs/users/bob", oid: key },
    { kind: "create-symbolic", ref: "refs/keys/fingerprint", target: "refs/users/alice" },
    { kind: "create", ref: "refs/heads/games/alice/bob/aaaaaaaaaaaaaaaa", oid: aliceGame },
    {
      kind: "create-symbolic",
      ref: "refs/my-games/alice/bob/aaaaaaaaaaaaaaaa",
      target: "refs/heads/games/alice/bob/aaaaaaaaaaaaaaaa",
    },
    {
      kind: "create-symbolic",
      ref: "refs/my-games/bob/alice/aaaaaaaaaaaaaaaa",
      target: "refs/heads/games/alice/bob/aaaaaaaaaaaaaaaa",
    },
    { kind: "create", ref: "refs/heads/games/bob/carol/bbbbbbbbbbbbbbbb", oid: bobGame },
    {
      kind: "create-symbolic",
      ref: "refs/my-games/bob/carol/bbbbbbbbbbbbbbbb",
      target: "refs/heads/games/bob/carol/bbbbbbbbbbbbbbbb",
    },
  ]);
  inspect("symbolic-ref", "HEAD", "refs/heads/main");
  const previous = process.env.GIT_PROTOCOL;
  let upload, receive, version2;
  try {
    process.env.GIT_PROTOCOL = "version=2";
    upload = finishTransport(git.uploadPack({ player: "alice" }));
    receive = finishTransport(git.receivePack({ player: "alice" }));
    version2 = finishTransport(git.uploadPack({ player: "alice", protocol: "version=2" }));
  } finally {
    if (previous === undefined) delete process.env.GIT_PROTOCOL;
    else process.env.GIT_PROTOCOL = previous;
  }
  const results = await Promise.all([upload, receive, version2]);
  for (const result of results) {
    assert.equal(result.code, 0, result.stderr);
    assert.ok(result.stdout.length > 0);
  }
  assert.doesNotMatch(results[0].stdout, /version 2/);
  for (const ref of [
    "refs/heads/main",
    "refs/users/alice",
    "refs/users/bob",
    "refs/heads/games/alice/bob/aaaaaaaaaaaaaaaa",
    "refs/heads/games/bob/carol/bbbbbbbbbbbbbbbb",
    "refs/my-games/alice/bob/aaaaaaaaaaaaaaaa",
  ]) assert.match(results[0].stdout, new RegExp(ref));
  for (const ref of [
    "refs/keys/fingerprint",
    "refs/my-games/bob/alice/aaaaaaaaaaaaaaaa",
    "refs/my-games/bob/carol/bbbbbbbbbbbbbbbb",
  ]) assert.doesNotMatch(results[0].stdout, new RegExp(ref));
  assert.match(results[1].stdout, /report-status/);
  assert.doesNotMatch(results[1].stdout, /refs\/(?:heads|users|keys)\//);
  assert.match(results[2].stdout, /version 2/);
  assert.throws(() => git.uploadPack({ player: "alice", protocol: "invalid" }), /Unsupported Git protocol/);
  assert.throws(() => git.uploadPack({ player: "alice/../bob" }), /Invalid player/);
});

function fixture() {
  const dir = mkdtempSync(`${tmpdir()}/gitchess-git-`);
  const path = `${dir}/repo.git`;
  execFileSync("git", ["init", "--bare", path], { stdio: "ignore" });
  const inspect = (...args) => execFileSync("git", [`--git-dir=${path}`, ...args]);
  return { dir, git: new GitRepository(path), inspect };
}

test("blobs preserve bytes and symbolic refs remain distinct from direct refs", () => {
  const { git, inspect } = fixture();
  assert.equal(git.hasRef("refs/users/alice"), false);
  assert.equal(git.readSymbolicRef("refs/keys/alice"), undefined);
  const bytes = Buffer.from([0, 255, 10, 13, 128]);
  const oid = git.writeBlob(bytes);
  assert.deepEqual(inspect("cat-file", "blob", oid), bytes);
  git.transaction([
    { kind: "create", ref: "refs/users/alice", oid },
    { kind: "create-symbolic", ref: "refs/keys/alice", target: "refs/users/alice" },
  ]);
  assert.equal(git.hasRef("refs/users/alice"), true);
  assert.equal(git.readSymbolicRef("refs/keys/alice"), "refs/users/alice");
  assert.throws(() => git.readSymbolicRef("refs/users/alice"), /Expected a symbolic ref/);
});

test("repository errors are not reported as missing refs", () => {
  const { dir } = fixture();
  const git = new GitRepository(`${dir}/missing.git`);
  for (const operation of [
    () => git.hasRef("refs/users/alice"),
    () => git.readSymbolicRef("refs/keys/alice"),
    () => git.writeBlob("key"),
  ]) {
    assert.throws(operation, (error) => {
      assert.ok(error instanceof GitCommandError);
      assert.notEqual(error.status, 0);
      assert.ok(error.stderr.length > 0);
      assert.equal(error.args[0], `--git-dir=${dir}/missing.git`);
      return true;
    });
  }
});

test("a conflicting transaction creates neither of its new refs", () => {
  const { git, inspect } = fixture();
  const oid = git.writeBlob("key");
  git.transaction([{ kind: "create", ref: "refs/users/alice", oid }]);
  assert.throws(() => git.transaction([
    { kind: "create", ref: "refs/users/bob", oid },
    { kind: "create-symbolic", ref: "refs/keys/bob", target: "refs/users/bob" },
    { kind: "create", ref: "refs/users/alice", oid },
  ]), GitCommandError);
  assert.equal(inspect("for-each-ref", "--format=%(refname)").toString().trim(), "refs/users/alice");
});

test("transaction inputs are validated before any refs are written", () => {
  const { git, inspect } = fixture();
  const oid = git.writeBlob("key");
  for (const invalid of [
    { kind: "create", ref: "HEAD", oid },
    { kind: "create", ref: "refs/users/bob\ncommit", oid },
    { kind: "create", ref: "refs/users/bob", oid: `${oid}\ncommit` },
    { kind: "create-symbolic", ref: "refs/keys/bob", target: "refs/users/bob\ncommit" },
  ]) {
    assert.throws(() => git.transaction([
      { kind: "create", ref: "refs/users/alice", oid },
      invalid,
    ]));
    assert.equal(inspect("for-each-ref").toString(), "");
  }
});
