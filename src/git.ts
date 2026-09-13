import { spawn, spawnSync } from "node:child_process";

type TransportOptions = { player: string; protocol?: string };

export type GitCommit = { tree: string; parents: string[]; author: string; message: string };
export type TreeEntry = { name: string; oid: string; mode?: "100644" | "100755" };

export type RefOperation =
  | { kind: "create"; ref: string; oid: string }
  | { kind: "update"; ref: string; oid: string; oldOid: string }
  | { kind: "verify-symbolic"; ref: string; target: string }
  | { kind: "create-symbolic"; ref: string; target: string };

export class GitCommandError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly status: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly stderr: string,
    cause?: Error,
  ) {
    super(`Git command failed: ${stderr.trim() || cause?.message || signal || status}`, { cause });
    this.name = "GitCommandError";
  }
}

export class GitRepository {
  constructor(private readonly path: string) {}

  uploadPack(options: TransportOptions) {
    return this.spawnTransport("upload-pack", options);
  }

  receivePack(options: TransportOptions) {
    return this.spawnTransport("receive-pack", options);
  }

  private spawnTransport(command: "upload-pack" | "receive-pack", options: TransportOptions) {
    if (options.protocol !== undefined && !/^version=[012]$/.test(options.protocol)) {
      throw new Error(`Unsupported Git protocol: ${options.protocol}`);
    }
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(options.player)) {
      throw new Error(`Invalid player: ${options.player}`);
    }
    const env: NodeJS.ProcessEnv = { ...process.env, GITCHESS_PLAYER: options.player };
    // Never inherit a protocol setting from the server's environment.
    delete env.GIT_PROTOCOL;
    if (options.protocol) env.GIT_PROTOCOL = options.protocol;
    const hideRefs = command === "upload-pack"
      ? [
          "refs/",
          "!refs/users/",
          "!refs/heads/main",
          `!refs/heads/games/${options.player}/`,
        ]
      : [
          "refs/",
          "!refs/new-game",
          "!refs/moves",
        ];
    const config = command === "upload-pack" ? "uploadpack.hideRefs" : "receive.hideRefs";
    const args = hideRefs.flatMap((pattern) => ["-c", `${config}=${pattern}`]);
    // The caller owns streams and lifecycle, including killing this process group.
    return spawn("git", [...args, command, this.path], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
  }

  private run(
    args: string[],
    input?: string | Buffer,
    expectedStatuses = [0],
    env: NodeJS.ProcessEnv = process.env,
  ) {
    const command = [`--git-dir=${this.path}`, ...args];
    const result = spawnSync("git", command, { input, encoding: "utf8", env });
    if (result.error || result.signal || !expectedStatuses.includes(result.status ?? -1)) {
      throw new GitCommandError(command, result.status, result.signal,
        result.stderr ?? "", result.error);
    }
    return result;
  }

  private validateRef(ref: string): void {
    if (!ref.startsWith("refs/")) throw new Error(`Expected a full ref name: ${ref}`);
    this.run(["check-ref-format", ref]);
  }

  hasRef(ref: string): boolean {
    this.validateRef(ref);
    // --exists distinguishes a missing ref (2) from an operational error (1).
    return this.run(["show-ref", "--exists", ref], undefined, [0, 2]).status === 0;
  }

  readSymbolicRef(ref: string): string | undefined {
    this.validateRef(ref);
    const result = this.run(["symbolic-ref", "--quiet", "--no-recurse", ref], undefined, [0, 1]);
    if (result.status === 0) return result.stdout.trim();
    if (this.hasRef(ref)) throw new Error(`Expected a symbolic ref: ${ref}`);
    return undefined;
  }

  readDirectRef(ref: string): string | undefined {
    this.validateRef(ref);
    const symbolic = this.run(["symbolic-ref", "--quiet", "--no-recurse", ref], undefined, [0, 1]);
    if (symbolic.status === 0) throw new Error(`Expected a direct ref: ${ref}`);
    if (!this.hasRef(ref)) return undefined;
    return this.run(["show-ref", "--verify", "--hash", ref]).stdout.trim();
  }

  refsPointingAt(oid: string, namespace: string): string[] {
    this.validateOid(oid);
    this.validateRef(namespace);
    const output = this.run([
      "for-each-ref",
      "--format=%(refname)",
      `--points-at=${oid}`,
      namespace,
    ]).stdout.trim();
    return output ? output.split("\n") : [];
  }

  writeBlob(contents: string | Buffer): string {
    return this.run(["hash-object", "-w", "--stdin"], contents).stdout.trim();
  }

  readCommit(oid: string): GitCommit {
    this.validateOid(oid);
    const raw = this.run(["cat-file", "commit", oid]).stdout;
    const split = raw.indexOf("\n\n");
    if (split < 0) throw new Error(`Invalid commit object: ${oid}`);
    const headers = raw.slice(0, split).split("\n");
    const tree = headers.find((line) => line.startsWith("tree "))?.slice(5);
    if (!tree) throw new Error(`Commit has no tree: ${oid}`);
    const authorHeader = headers.find((line) => line.startsWith("author "));
    const author = authorHeader && /^author (.*) <[^<>]*> \d+ [+-]\d{4}$/.exec(authorHeader)?.[1];
    if (!author) throw new Error(`Commit has an invalid author: ${oid}`);
    return {
      tree,
      parents: headers.filter((line) => line.startsWith("parent ")).map((line) => line.slice(7)),
      author,
      message: raw.slice(split + 2),
    };
  }

  readFile(commit: string, path: string): Buffer {
    this.validateOid(commit);
    if (!/^[A-Za-z0-9.-]+$/.test(path)) throw new Error(`Invalid file name: ${path}`);
    const result = spawnSync("git", [`--git-dir=${this.path}`, "cat-file", "blob", `${commit}:${path}`]);
    if (result.error || result.signal || result.status !== 0) {
      throw new GitCommandError(
        [`--git-dir=${this.path}`, "cat-file", "blob", `${commit}:${path}`],
        result.status,
        result.signal,
        result.stderr?.toString() ?? "",
        result.error,
      );
    }
    return result.stdout;
  }

  writeTree(entries: readonly TreeEntry[]): string {
    const lines = [...entries].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, oid, mode = "100644" }) => {
      if (!/^[A-Za-z0-9.-]+$/.test(name)) throw new Error(`Invalid file name: ${name}`);
      this.validateOid(oid);
      return `${mode} blob ${oid}\t${name}`;
    });
    return this.run(["mktree"], `${lines.join("\n")}${lines.length ? "\n" : ""}`).stdout.trim();
  }

  createCommit(tree: string, parents: readonly string[], message: string, author: string): string {
    this.validateOid(tree);
    for (const parent of parents) this.validateOid(parent);
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(author)) throw new Error(`Invalid author: ${author}`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: author,
      GIT_AUTHOR_EMAIL: `${author}@gitchess`,
      GIT_COMMITTER_NAME: "gitchess",
      GIT_COMMITTER_EMAIL: "server@gitchess",
    };
    return this.run(
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])],
      `${message}\n`,
      [0],
      env,
    ).stdout.trim();
  }

  private validateOid(oid: string): void {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid)) {
      throw new Error(`Expected a full object ID: ${oid}`);
    }
  }

  transaction(operations: readonly RefOperation[]): void {
    const commands = operations.map((operation) => {
      this.validateRef(operation.ref);
      switch (operation.kind) {
        case "create":
        case "update":
          this.validateOid(operation.oid);
          if (operation.kind === "update") {
            this.validateOid(operation.oldOid);
            return `update ${operation.ref} ${operation.oid} ${operation.oldOid}`;
          }
          return `create ${operation.ref} ${operation.oid}`;
        case "create-symbolic":
        case "verify-symbolic":
          this.validateRef(operation.target);
          return `symref-${operation.kind === "create-symbolic" ? "create" : "verify"} ${operation.ref} ${operation.target}`;
      }
    });
    // Validate every operation before applying the whole batch atomically.
    this.run(["update-ref", "--no-deref", "--stdin"],
      ["start", ...commands, "prepare", "commit", ""].join("\n"));
  }
}
