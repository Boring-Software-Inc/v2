import { fileURLToPath } from "node:url";
/** Generates the gitignored route tree so CI can typecheck without a dev server. */
import { Generator, getConfig } from "@tanstack/router-generator";

// `fileURLToPath`, not `.pathname`: on Windows the latter yields "/C:/..."
// with a leading slash, which no fs call accepts.
const root = fileURLToPath(new URL("..", import.meta.url));
const config = getConfig({}, root);
const generator = new Generator({ config, root });
await generator.run();
