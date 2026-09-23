import { workerData } from "node:worker_threads";
import { GameSite } from "./game-site.js";

const { repo, output, interval } = workerData as { repo: string; output: string; interval: number };
const site = new GameSite(repo, output);
let lastError: string | undefined;
function refresh(): void {
  try {
    site.refresh();
    lastError = undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastError) console.error("Game website refresh:", message);
    lastError = message;
  }
}
refresh();
setInterval(refresh, interval);
