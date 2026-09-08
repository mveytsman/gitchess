import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";
import { Users, fingerprint } from "../dist/users.js";
import { GitRepository } from "../dist/git.js";
import { authentication } from "../dist/auth.js";

function fixture() {
  const dir = mkdtempSync(`${tmpdir()}/chesshub-users-`);
  const repo = `${dir}/repo.git`;
  execFileSync("git", ["init", "--bare", repo], { stdio: "ignore" });
  return { dir, repo, users: new Users(new GitRepository(repo)) };
}
function keypair() {
  const pair = ssh2.utils.generateKeyPairSync("ed25519");
  const privateKey = ssh2.utils.parseKey(pair.private);
  return { publicKey: privateKey.getPublicSSH(), privateKey };
}
function context(fields) {
  return Object.assign(new EventEmitter(), {
    username: "git", accepted: false, rejected: undefined,
    accept() { this.accepted = true; },
    reject(methods, partial) { this.rejected = { methods, partial }; },
  }, fields);
}
function signed(key) {
  const blob = Buffer.from("session-bound authentication test");
  return context({ method: "publickey", key: { data: key.publicKey },
    blob, signature: key.privateKey.sign(blob) });
}

test("registration stores a public-key blob and a symbolic fingerprint lookup", () => {
  const { repo, users } = fixture();
  const { publicKey } = keypair();
  assert.equal(users.lookup(publicKey), undefined);
  assert.equal(users.exists("alice"), false);
  assert.equal(users.register("alice", publicKey), "alice");
  assert.equal(users.exists("alice"), true);
  assert.equal(users.lookup(publicKey), "alice");
  const git = (...args) => execFileSync("git", [`--git-dir=${repo}`, ...args], { encoding: "utf8" }).trim();
  assert.equal(git("symbolic-ref", `refs/keys/${fingerprint(publicKey)}`), "refs/users/alice");
  assert.equal(git("cat-file", "blob", "refs/users/alice"), `ssh-ed25519 ${publicKey.toString("base64")}`);
  assert.equal(users.register("another", publicKey), "alice");
  assert.equal(git("for-each-ref", "--format=%(refname)", "refs/users"), "refs/users/alice");
});

test("duplicate names and invalid names do not leave a key mapping", () => {
  const { users } = fixture();
  const alice = keypair(), other = keypair();
  users.register("alice", alice.publicKey);
  assert.throws(() => users.register("alice", other.publicKey), /taken/);
  for (const name of ["Alice", "../alice", "a/b", "", "x\ncreate refs/users/bob"]) {
    assert.throws(() => users.register(name, other.publicKey), /Use 1/);
  }
  assert.equal(users.lookup(other.publicKey), undefined);
});

test("concurrent registrations cannot split a username or key mapping", async () => {
  const { repo, users } = fixture();
  const moduleUrl = new URL("../dist/users.js", import.meta.url).href;
  const attempt = (username, publicKey) => promisify(execFile)(process.execPath,
    ["--input-type=module", "-e", `
      import { Users } from ${JSON.stringify(moduleUrl)};
      import { GitRepository } from ${JSON.stringify(new URL("../dist/git.js", import.meta.url).href)};
      try {
        console.log(new Users(new GitRepository(process.argv[1])).register(process.argv[2], Buffer.from(process.argv[3], 'base64')));
      } catch { process.exitCode = 1; }
    `, repo, username, publicKey.toString("base64")]);
  const alice = keypair(), bob = keypair();
  const names = await Promise.allSettled([
    attempt("shared", alice.publicKey), attempt("shared", bob.publicKey),
  ]);
  assert.equal(names.filter(result => result.status === "fulfilled").length, 1);
  assert.equal([users.lookup(alice.publicKey), users.lookup(bob.publicKey)].filter(Boolean).length, 1);
  const oneKey = keypair();
  const keys = await Promise.allSettled([
    attempt("first", oneKey.publicKey), attempt("second", oneKey.publicKey),
  ]);
  const winner = users.lookup(oneKey.publicKey);
  assert.ok(winner === "first" || winner === "second");
  for (const result of keys) {
    assert.equal(result.status, "fulfilled");
    assert.equal(result.value.stdout.trim(), winner);
  }
});

test("signup requires a signed key, retries names, and recognizes returning users", () => {
  const { users } = fixture();
  const key = keypair();
  let player;
  const auth = authentication(users, (name) => { player = name; });
  const premature = context({ method: "keyboard-interactive" });
  auth(premature);
  assert.equal(premature.accepted, false);
  const probe = context({ method: "publickey", key: { data: key.publicKey } });
  auth(probe);
  assert.equal(probe.accepted, true);
  assert.equal(player, undefined);
  auth(premature);
  assert.equal(premature.accepted, false);
  const proof = signed(key);
  auth(proof);
  assert.deepEqual(proof.rejected, { methods: ["keyboard-interactive"], partial: true });
  assert.equal(proof.accepted, false);
  const answers = ["../invalid", "alice"];
  const signup = context({ method: "keyboard-interactive",
    prompt(prompts, title, instructions, callback) {
      assert.equal(prompts[0].echo, true);
      callback([answers.shift()]);
    },
  });
  auth(signup);
  assert.equal(signup.accepted, true);
  assert.equal(player, "alice");
  let returning;
  const next = authentication(users, (name) => { returning = name; });
  const login = signed(key);
  next(login);
  assert.equal(login.accepted, true);
  assert.equal(returning, "alice");
});

test("invalid signatures and another connection cannot use pending signup", () => {
  const { users } = fixture();
  const key = keypair();
  const auth = authentication(users, () => assert.fail("must not authenticate"));
  const bad = signed(key);
  bad.signature = keypair().privateKey.sign(bad.blob);
  auth(bad);
  assert.equal(bad.accepted, false);
  auth(signed(key));
  const otherConnection = authentication(users, () => assert.fail("must not authenticate"));
  const attempt = context({ method: "keyboard-interactive" });
  otherConnection(attempt);
  assert.equal(attempt.accepted, false);
});

test("users are discoverable and fetchable but identity pushes are rejected", () => {
  const { dir, repo, users } = fixture();
  const key = keypair();
  users.register("alice", key.publicKey);
  const hook = fileURLToPath(new URL("../dist/hooks/pre-receive.js", import.meta.url));
  writeFileSync(`${repo}/hooks/pre-receive`, `#!/bin/sh\nexec node '${hook}'\n`, { mode: 0o755 });
  const listing = execFileSync("git", ["ls-remote", repo, "refs/users/*"], { encoding: "utf8" });
  assert.match(listing, /refs\/users\/alice/);
  const client = `${dir}/client`;
  execFileSync("git", ["init", client], { stdio: "ignore" });
  const git = (...args) => execFileSync("git", ["-C", client, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("fetch", repo, "+refs/users/*:refs/chesshub/users/*");
  assert.match(git("cat-file", "blob", "refs/chesshub/users/alice"), /^ssh-ed25519 /);
  const zero = "0".repeat(40);
  const oid = git("rev-parse", "refs/chesshub/users/alice").trim();
  for (const ref of ["refs/users/alice", "refs/users/new", `refs/keys/${fingerprint(key.publicKey)}`, "refs/keys/new"]) {
    for (const [oldOid, newOid] of [[zero, oid], [oid, oid], [oid, zero]]) {
      const check = spawnSync(process.execPath, [hook], { input: `${oldOid} ${newOid} ${ref}\n`, encoding: "utf8" });
      assert.equal(check.status, 1);
    }
    const push = spawnSync("git", ["-C", client, "push", repo, `refs/chesshub/users/alice:${ref}`], { encoding: "utf8" });
    // Existing identical refs may be skipped by Git; new refs exercise the hook.
    if (ref.endsWith("/new")) {
      assert.notEqual(push.status, 0);
      assert.match(push.stderr, /Use games\//);
    }
  }
  const deletion = spawnSync("git", ["-C", client, "push", repo, ":refs/users/alice"], { encoding: "utf8" });
  assert.notEqual(deletion.status, 0);
  assert.equal(users.lookup(key.publicKey), "alice");
});
