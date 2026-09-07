import ssh2, { type AuthContext } from "ssh2";
import { RegistrationError, Users } from "./users.js";

// One handler per SSH connection; never share pending key state across clients.
export function authentication(users: Users, authenticated: (username: string) => void) {
  let verifiedKey: Buffer | undefined;

  return (ctx: AuthContext): void => {
    if (ctx.username !== "git") {
      ctx.reject(["publickey"]);
      return;
    }
    if (ctx.method === "publickey") {
      verifiedKey = undefined;
      const key = ssh2.utils.parseKey(ctx.key.data);
      if (key instanceof Error || Array.isArray(key)) {
        ctx.reject(["publickey"]);
        return;
      }
      if (!ctx.signature) {
        // Only acknowledges the probe; ssh2 still requires proof of possession.
        ctx.accept();
        return;
      }
      if (!ctx.blob || key.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) {
        ctx.reject(["publickey"]);
        return;
      }
      try {
        const username = users.lookup(ctx.key.data);
        if (username) {
          authenticated(username);
          ctx.accept();
        } else {
          verifiedKey = Buffer.from(ctx.key.data);
          // The key has succeeded, but signup must complete before exec is allowed.
          ctx.reject(["keyboard-interactive"], true);
        }
      } catch (error) {
        console.error("Authentication:", error);
        ctx.reject();
      }
      return;
    }
    if (ctx.method === "keyboard-interactive" && verifiedKey) {
      const publicKey = verifiedKey;
      let aborted = false;
      ctx.once("abort", () => { aborted = true; });
      const ask = (instructions: string, attempts: number): void => {
        ctx.prompt([{ prompt: "Choose a ChessHub username: ", echo: true }],
          "Welcome to ChessHub", instructions, (answers) => {
            if (aborted || !Array.isArray(answers)) return;
            try {
              const username = users.register(answers[0] ?? "", publicKey);
              authenticated(username);
              ctx.accept();
            } catch (error) {
              if (error instanceof RegistrationError && attempts < 5) {
                ask(error.message, attempts + 1);
              } else {
                console.error("Registration:", error);
                ctx.reject();
              }
            }
          });
      };
      ask("Your username and public key will be publicly discoverable.", 1);
      return;
    }
    ctx.reject(verifiedKey ? ["keyboard-interactive"] : ["publickey"]);
  };
}
