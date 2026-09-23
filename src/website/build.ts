import { fileURLToPath } from "node:url";
import { buildSite, websiteOutput, websiteSource } from "./layout.js";

buildSite(fileURLToPath(websiteSource), fileURLToPath(websiteOutput));
