import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Chess } from "chess.js";
import { GitRepository } from "../git.js";
import { parseGameRef } from "../games.js";
import { escapeHtml as escape, renderPage } from "./layout.js";

type Entry = { oid: string; author: string; message: string };
type PublishedGame = { oid: string; id: string; row: string };

function writeAtomic(path: string, contents: string | Buffer): void {
  writeFileSync(`${path}.tmp`, contents);
  renameSync(`${path}.tmp`, path);
}

// Runs in a worker: synchronous Git reads never block HTTP requests.
export class GameSite {
  private published = new Map<string, PublishedGame>();
  private signature: string | undefined;
  private buildStamp: number | undefined;

  constructor(private readonly repo: string, private readonly output: string) {}

  refresh(): boolean {
    const slugs: string[] = JSON.parse(readFileSync(join(this.output, "navigation.json"), "utf8"));
    const buildStamp = statSync(join(this.output, "navigation.json")).mtimeMs;
    const buildChanged = buildStamp !== this.buildStamp;
    const directory = join(this.output, "games");
    mkdirSync(directory, { recursive: true });
    if (!existsSync(join(this.repo, "HEAD"))) {
      if (this.signature === "missing" && !buildChanged) return false;
      this.writeIndex("<p>The chess repository is not available. Games will appear here when it becomes available.</p>", slugs);
      this.signature = "missing";
      this.buildStamp = buildStamp;
      return true;
    }
    const git = new GitRepository(this.repo);
    const refs = git.listDirectRefs("refs/heads/games");
    const signature = JSON.stringify(refs);
    // Rebuilding the static site removes the generated pages; restore them even
    // if the repository itself has not changed.
    const filesPresent = [...this.published.values()].every(({ id }) => existsSync(join(directory, id, "index.html")));
    if (signature === this.signature && filesPresent && !buildChanged) return false;
    const next = new Map<string, PublishedGame>();
    for (const { ref, oid } of refs) {
      const previous = this.published.get(ref);
      if (previous?.oid === oid && filesPresent && !buildChanged) {
        next.set(ref, previous);
        continue;
      }
      const game = parseGameRef(ref);
      const history: Entry[] = [];
      let cursor: string | undefined = oid;
      while (cursor) {
        const commit = git.readCommit(cursor);
        if (commit.parents.length > 1) throw new Error(`Game history is not linear: ${ref}`);
        history.push({ oid: cursor, author: commit.author, message: commit.message.trim() });
        cursor = commit.parents[0];
      }
      history.reverse();
      const initial = history[0]!;
      const chess = new Chess(git.readFile(initial.oid, "position.fen").toString().trim());
      const moves = history.slice(1).map((entry, index) => {
        const move = chess.move(entry.message);
        const label = `${Math.floor(index / 2) + 1}${index % 2 ? "…" : "."} ${move.san}`;
        return `<tr><td>${escape(label)}</td><td>${escape(entry.author)}</td><td><code>${entry.oid.slice(0, 10)}</code></td></tr>`;
      });
      const fen = git.readFile(oid, "position.fen").toString().trim();
      if (chess.fen() !== fen) throw new Error(`Game history does not match position: ${ref}`);
      const status = chess.isCheckmate() ? `${chess.turn() === "w" ? "0–1" : "1–0"} · Checkmate`
        : chess.isStalemate() ? "½–½ · Stalemate"
        : chess.isThreefoldRepetition() ? "½–½ · Threefold repetition"
        : chess.isInsufficientMaterial() ? "½–½ · Insufficient material"
        : chess.isDraw() ? "½–½ · Draw"
        : `${chess.turn() === "w" ? "White" : "Black"} to move${chess.isCheck() ? " · Check" : ""}`;
      const lastMove = history.length > 1 ? history.at(-1)!.message : "—";
      const title = `${game.white} / ${game.black}`;
      const gameDir = join(directory, game.id);
      mkdirSync(gameDir, { recursive: true });
      // Name images by commit so a page and its board always describe the same position.
      writeAtomic(join(gameDir, `${oid}.svg`), git.readFile(oid, "position.svg"));
      const html = `<p><a href="/games/">← Games</a></p><h1>${escape(title)}</h1>
<p>${escape(status)}</p>
<div class="game-layout"><div class="position"><img src="/games/${game.id}/${oid}.svg" alt="Chess position after ${moves.length} moves played: ${escape(fen)}"><p class="muted">White at bottom</p></div>
<div class="game-history"><h2>Move history</h2>
${moves.length ? `<table><thead><tr><th>Move</th><th>Player</th><th>Commit</th></tr></thead><tbody>${moves.join("\n")}</tbody></table>` : "<p>No moves yet.</p>"}</div></div>
<h2>Follow in Git</h2><pre>git fetch origin
git switch --track origin/${escape(ref.slice("refs/heads/".length))}</pre>
<p class="muted">Game ${game.id} · Refresh this page to see new moves.</p>`;
      writeAtomic(join(gameDir, "index.html"), renderPage(title, html, "games", slugs));
      next.set(ref, { oid, id: game.id, row: `<tr><td><a href="/games/${game.id}/">${escape(title)}</a><br><small>${game.id}</small></td><td>${escape(status)}</td><td><code>${escape(lastMove)}</code></td><td>${moves.length}</td></tr>` });
    }
    const body = next.size ? `<div class="table-scroll"><table><thead><tr><th>Game (white / black)</th><th>Status</th><th>Last move</th><th>Moves played</th></tr></thead><tbody>${[...next.values()].map((game) => game.row).join("\n")}</tbody></table></div>`
      : '<p>No games yet. <a href="/about/">Start a game through Git</a> and it will appear here.</p>';
    this.writeIndex(body, slugs);
    for (const [ref, game] of this.published) {
      if (!next.has(ref)) rmSync(join(directory, game.id), { recursive: true, force: true });
    }
    this.published = next;
    this.signature = signature;
    this.buildStamp = buildStamp;
    return true;
  }

  private writeIndex(body: string, slugs: string[]): void {
    writeAtomic(join(this.output, "games/index.html"), renderPage("games", `<h1>Games</h1>${body}<p class="muted">Public games from the chess repository. Refresh to see updates.</p>`, "games", slugs));
  }
}
