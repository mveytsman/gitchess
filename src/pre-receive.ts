import { createInterface } from "node:readline";

// These refs are public to readers, but only server-side registration may write them.
for await (const line of createInterface({ input: process.stdin })) {
  const ref = line.split(" ")[2] ?? "";
  if (/^refs\/(users|keys)(\/|$)/.test(ref)) {
    console.error(`Identity ref ${ref} is server-managed; direct pushes are not allowed.`);
    process.exitCode = 1;
  }
}
