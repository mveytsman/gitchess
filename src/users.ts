import { createHash } from "node:crypto";
import ssh2 from "ssh2";
import { GitCommandError, GitRepository } from "./git.js";

export function fingerprint(publicKey: Buffer): string {
  return createHash("sha256").update(publicKey).digest("hex");
}

export class RegistrationError extends Error {}

export class Users {
  constructor(private readonly git: GitRepository) {}

  exists(username: string): boolean {
    return this.git.hasRef(`refs/users/${username}`);
  }

  lookup(publicKey: Buffer): string | undefined {
    const target = this.git.readSymbolicRef(`refs/keys/${fingerprint(publicKey)}`);
    if (target === undefined) return undefined;
    const match = /^refs\/users\/([a-z_][a-z0-9_-]{0,31})$/.exec(target);
    if (!match) throw new Error("Invalid user mapping in repository");
    return match[1]!;
  }

  register(username: string, publicKey: Buffer): string {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(username)) {
      throw new RegistrationError(
        "Use 1–32 lowercase letters, digits, underscores or hyphens; start with a letter.",
      );
    }
    const existing = this.lookup(publicKey);
    if (existing) return existing;
    const parsed = ssh2.utils.parseKey(publicKey);
    if (parsed instanceof Error || Array.isArray(parsed)) {
      throw new Error("Invalid SSH public key");
    }
    const oid = this.git.writeBlob(
      `${parsed.type} ${publicKey.toString("base64")}\n`);
    const userRef = `refs/users/${username}`;
    try {
      this.git.transaction([
        { kind: "create", ref: userRef, oid },
        { kind: "create-symbolic", ref: `refs/keys/${fingerprint(publicKey)}`, target: userRef },
      ]);
    } catch (error) {
      if (!(error instanceof GitCommandError)) throw error;
      // A concurrent connection using this key may have registered first.
      const winner = this.lookup(publicKey);
      if (winner) return winner;
      if (this.exists(username)) throw new RegistrationError("That username is taken. Choose another.");
      throw error;
    }
    return username;
  }
}
