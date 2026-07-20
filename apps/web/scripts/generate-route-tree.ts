/**
 * Emit `src/routeTree.gen.ts` without booting Vite. Required for `tsc` in CI
 * where the file is gitignored and never produced by a prior dev session.
 */
import { Generator, getConfig } from "@tanstack/router-generator";

const root = new URL("..", import.meta.url).pathname;
const config = getConfig({}, root);
const generator = new Generator({ config, root });
await generator.run();
