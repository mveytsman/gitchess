import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ssh2, { type Connection } from "ssh2";
import { authentication } from "./auth.js";
import { Users } from "./users.js";
import { GitRepository } from "./git.js";

const { Server } = ssh2;

// Compiled entry point lives in dist/; repository paths do not depend on cwd.
const root = fileURLToPath(new URL("../", import.meta.url));
const repo = resolve(process.env.GITCHESS_REPO ?? `${root}/var/chess.git`);
const hostKeyPath = resolve(
  process.env.GITCHESS_HOST_KEY ?? `${root}/var/ssh_host_ed25519`,
);
const port = Number(process.env.GITCHESS_PORT ?? 2222);
const host = process.env.GITCHESS_HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("GITCHESS_PORT must be an integer between 1 and 65535");
}
if (!host) throw new Error("GITCHESS_HOST must not be empty");

if (!existsSync(`${repo}/HEAD`)) {
  throw new Error(`Repository missing at ${repo}; run npm run setup first`);
}
if (!existsSync(hostKeyPath)) {
  throw new Error(`SSH host key missing at ${hostKeyPath}; run npm run setup first`);
}

const connections = new Set<Connection>();
const repository = new GitRepository(repo);
const users = new Users(repository);
const server = new Server({ hostKeys: [readFileSync(hostKeyPath)] }, (client) => {
  let player: string | undefined;
  connections.add(client);
  client.once("close", () => connections.delete(client));
  client.on("error", (error: Error) => console.error("SSH:", error.message));
  client.on("authentication", authentication(users, (username) => { player = username; }));

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
        if (!match || !player) return reject();

        const channel = accept();
        const git = match[1] === "upload-pack"
          ? repository.uploadPack({ player, protocol })
          : repository.receivePack({ player, protocol });
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
server.listen(port, host, () => {
  console.log(`SSH listening on ${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    for (const client of connections) client.end();
  });
}
