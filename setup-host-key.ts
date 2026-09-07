import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ssh2 from "ssh2";

const root = fileURLToPath(new URL("../", import.meta.url));
const hostKeyPath = resolve(
  process.env.CHESSHUB_HOST_KEY ?? `${root}/var/ssh_host_ed25519`,
);

if (existsSync(hostKeyPath)) {
  console.log(`Keeping existing SSH host key at ${hostKeyPath}`);
} else {
  mkdirSync(dirname(hostKeyPath), { recursive: true, mode: 0o700 });
  writeFileSync(hostKeyPath, ssh2.utils.generateKeyPairSync("ed25519").private, {
    mode: 0o600,
    flag: "wx",
  });
  console.log(`Generated SSH host key at ${hostKeyPath}`);
}
