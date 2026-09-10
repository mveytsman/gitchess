import { GitRepository, type RefOperation } from "./git.js";
import { Users } from "./users.js";

export function gameRefs(ref: string, player: string | undefined) {
  const match = /^refs\/heads\/games\/([a-z_][a-z0-9_-]{0,31})\/([a-z_][a-z0-9_-]{0,31})\/([a-zA-Z0-9_-]{1,64})$/.exec(ref);
  if (!match) throw new Error("Use games/<you>/<opponent>/<id>; id must be 1–64 letters, digits, underscores or hyphens");
  const owner = match[1]!, opponent = match[2]!, id = match[3]!;
  if (!player || owner !== player) throw new Error("You may only push games under your own username");
  if (owner === opponent) throw new Error("Choose another player as your opponent");
  return {
    owner, opponent,
    aliases: [ref, `refs/heads/games/${opponent}/${owner}/${id}`],
    canonical: `refs/heads/canonical/${[owner, opponent].sort().join("/")}/${id}`,
  };
}

export function gameUpdate(git: GitRepository, ref: string, oldOid: string, oid: string, player: string | undefined): RefOperation[] {
  const game = gameRefs(ref, player);
  if (/^0+$/.test(oid)) throw new Error("Game deletion is not supported");
  const users = new Users(git);
  for (const username of [game.owner, game.opponent]) {
    if (!users.exists(username)) throw new Error(`Unknown player: ${username}`);
  }
  if (/^0+$/.test(oldOid)) {
    return [
      { kind: "create", ref: game.canonical, oid },
      ...game.aliases.map((alias): RefOperation => ({ kind: "create-symbolic", ref: alias, target: game.canonical })),
    ];
  }
  return [
    ...game.aliases.map((alias): RefOperation => ({ kind: "verify-symbolic", ref: alias, target: game.canonical })),
    { kind: "update", ref: game.canonical, oid, oldOid },
  ];
}
