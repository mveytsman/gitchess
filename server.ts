import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ssh2, { type Connection } from "ssh2";

const { Server, utils } = ssh2;

// Compiled entry point lives in dist/; repository paths do not depend on cwd.
const root = fileURLToPath(new URL("../", import.meta.url));
const repo = resolve(process.env.CHESSHUB_REPO ?? `${root}/var/chess.git`);
const hostKeyPath = resolve(
  process.env.CHESSHUB_HOST_KEY ?? `${root}/var/ssh_host_ed25519`,
);
const port = Number(process.env.CHESSHUB_PORT ?? 2222);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("CHESSHUB_PORT must be an integer between 1 and 65535");
}

if (!existsSync(`${repo}/HEAD`)) {
  throw new Error(`Repository missing at ${repo}; run npm run setup first`);
}
if (!existsSync(hostKeyPath)) {
  throw new Error(`SSH host key missing at ${hostKeyPath}; run npm run setup first`);
}

const connections = new Set<Connection>();
const server = new Server({ hostKeys: [readFileSync(hostKeyPath)] }, (client) => {
  connections.add(client);
  client.once("close", () => connections.delete(client));
  client.on("error", (error: Error) => console.error("SSH:", error.message));
  client.on("authentication", (ctx) => {
    if (ctx.username !== "git" || ctx.method !== "publickey") {
      ctx.reject(["publickey"]);
      return;
    }
    const key = utils.parseKey(ctx.key.data);
    if (
      key instanceof Error ||
      Array.isArray(key) ||
      (ctx.signature &&
        (!ctx.blob ||
          key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true))
    ) {
      ctx.reject(["publickey"]);
      return;
    }
    // Unsigned requests are key probes; ssh2 then requires a signed request.
    ctx.accept();
  });

  client.on("ready", () => {
    client.on("session", (acceptSession) => {
      const session = acceptSession();
      let protocol: string | undefined;
      session.on("env", (accept, reject, info) => {
        if (info.key === "GIT_PROTOCOL" && /^version=[012]$/.test(info.val)) {
          protocol = info.val;
          accept?.();
        } else {
          reject?.();
        }
      });
      session.once("exec", (accept, reject, info) => {
        const match = /^git-(upload-pack|receive-pack) '\/?chess\.git'$/.exec(
          info.command,
        );
        if (!match) return reject();

        const channel = accept();
        const env = { ...process.env };
        // Only forward the Git protocol setting accepted for this SSH session.
        delete env.GIT_PROTOCOL;
        if (protocol) env.GIT_PROTOCOL = protocol;
        const git = spawn("git", [match[1]!, repo], {
          env,
          stdio: ["pipe", "pipe", "pipe"],
          detached: true,
        });
        let finished = false;
        const stop = () => {
          if (!git.pid) return;
          try {
            // Git may have spawned a hook; terminate the entire process group.
            process.kill(-git.pid, "SIGTERM");
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
              console.error(error);
            }
          }
        };
        const finish = (code: number) => {
          if (finished) return;
          finished = true;
          channel.exit(code);
          channel.end();
        };

        channel.pipe(git.stdin);
        git.stdout.pipe(channel, { end: false });
        git.stderr.pipe(channel.stderr, { end: false });
        git.stdin.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code !== "EPIPE") console.error(error);
        });
        git.on("error", (error) => {
          console.error("Git:", error.message);
          finish(1);
        });
        git.on("close", (code) => finish(code ?? 1));
        channel.on("error", stop);
        channel.on("close", () => {
          client.off("close", stop);
          if (!finished) stop();
        });
        client.once("close", stop);
      });
    });
  });
});

server.on("error", (error: Error) => {
  console.error("SSH server:", error.message);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  console.log(`SSH listening at ssh://git@localhost:${port}/chess.git`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    for (const client of connections) client.end();
  });
}
