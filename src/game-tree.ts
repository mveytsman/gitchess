import { GitRepository } from "./git.js";
import { renderPosition } from "./position.js";

export const GITCHESS_VERSION = "0.1";

type RepositoryFiles = { readme: string; command: string };

function repositoryFiles(git: GitRepository): RepositoryFiles {
  const mainOid = git.readDirectRef("refs/heads/main");
  if (!mainOid) throw new Error("gitchess's main branch has not been initialized");
  return {
    readme: git.writeBlob(git.readFile(mainOid, "README.md")),
    command: git.writeBlob(git.readFile(mainOid, "git-chess")),
  };
}

export function buildGameTree(git: GitRepository, fen: string): string {
  const files = repositoryFiles(git);
  const position = renderPosition(fen);
  return git.writeTree([
    { name: ".gitchess-version", oid: git.writeBlob(`${GITCHESS_VERSION}\n`) },
    { name: "README.md", oid: files.readme },
    { name: "git-chess", oid: files.command, mode: "100755" },
    { name: "position.fen", oid: git.writeBlob(`${fen}\n`) },
    { name: "position.svg", oid: git.writeBlob(position.svg) },
    { name: "position.png", oid: git.writeBlob(position.png) },
  ]);
}
