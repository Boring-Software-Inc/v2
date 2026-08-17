import { fileURLToPath } from "node:url";
/**
 * Emit `src/routeTree.gen.ts` without booting Vite. Required for `tsc` in CI
 * where the file is gitignored and never produced by a prior dev session.
 */
import { Generator, getConfig } from "@tanstack/router-generator";

// `fileURLToPath`, not `.pathname`: on Windows the latter yields "/C:/..."
// with a leading slash, which no fs call accepts.
const root = fileURLToPath(new URL("..", import.meta.url));
const config = getConfig({}, root);
const generator = new Generator({ config, root });
await generator.run();
