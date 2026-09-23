import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";

export const websiteSource = new URL("../website/", import.meta.url);
export const websiteOutput = new URL("./public/", import.meta.url);

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

// Markdown is trusted, checked-in website content, never player-supplied text.
export function buildSite(source: string, output: string): void {
  const markdown = new Marked();
  const pages = readdirSync(join(source, "pages"))
    .filter((file) => /^[a-z][a-z0-9-]*\.md$/.test(file))
    .map((file) => {
      const slug = file.slice(0, -3);
      const content = readFileSync(join(source, "pages", file), "utf8");
      const title = /^# (.+)$/m.exec(content)?.[1] ?? slug;
      return { slug, title, html: markdown.parse(content, { async: false }) };
    })
    .sort((a, b) => a.slug === "about" ? -1 : b.slug === "about" ? 1 : a.slug.localeCompare(b.slug));
  if (!pages.some((page) => page.slug === "about")) {
    throw new Error("website/pages/about.md is required");
  }

  if (pages.some((page) => page.slug === "games")) throw new Error("games is reserved for generated game pages");
  const slugs = ["about", "games", ...pages.map((page) => page.slug).filter((slug) => slug !== "about")];

  // This directory contains generated website files only.
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "style.css"), readFileSync(join(source, "style.css")));
  writeFileSync(join(output, "navigation.json"), JSON.stringify(slugs));
  mkdirSync(join(output, "games"), { recursive: true });
  writeFileSync(join(output, "games/index.html"), renderPage("Games", "<h1>Games</h1><p>Game data has not been generated yet. Start the web server to read the chess repository.</p>", "games", slugs));
  for (const page of pages) {
    const html = renderPage(page.title, page.html, page.slug, slugs);
    mkdirSync(join(output, page.slug), { recursive: true });
    writeFileSync(join(output, page.slug, "index.html"), html);
    if (page.slug === "about") writeFileSync(join(output, "index.html"), html);
  }
}

export function renderPage(title: string, content: string, active: string, slugs: string[]): string {
  const tabs = slugs.map((slug) =>
      `<a href="/${slug}/"${slug === active ? ' aria-current="page"' : ""}>${escapeHtml(slug)}</a>`,
    ).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — gitchess</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header><strong><a href="/">gitchess</a></strong><p>Chess, entirely through the Git protocol.</p></header>
<nav aria-label="Project">${tabs}
<a href="https://github.com/mveytsman/gitchess">source</a></nav>
<main>${content}</main>
<footer>gitchess · a learning project exploring “FUSE for Git”</footer>
</body>
</html>
`;
}
