import { fileURLToPath } from "node:url";
import { buildSite, websiteOutput, websiteSource } from "./site.js";

buildSite(fileURLToPath(websiteSource), fileURLToPath(websiteOutput));
