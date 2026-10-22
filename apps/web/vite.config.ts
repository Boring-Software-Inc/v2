import { builtinModules } from "node:module";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;

const sentryPlugins = sentryAuthToken
	? sentryVitePlugin({
			org: process.env.SENTRY_ORG || "boring-software-inc",
			project: process.env.SENTRY_PROJECT || "tripwire-web",
			authToken: sentryAuthToken,
			telemetry: false,
			release: { create: false, inject: false },
			sourcemaps: {
				filesToDeleteAfterUpload: ["./.output/public/**/*.map"],
			},
			errorHandler: (error) => {
				console.warn(`sentry source map upload failed: ${error.message}`);
			},
		}).map((plugin) => ({
			...plugin,
			applyToEnvironment: (environment: { name: string }) =>
				environment.name === "client",
		}))
	: [];

export default defineConfig({
	environments: {
		client: {
			build: { sourcemap: sentryAuthToken ? "hidden" : false },
		},
	},
	plugins: [
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart(),
		nitro({
			compressPublicAssets: { gzip: true, brotli: true },
			rollupConfig: { external: [/^@resvg\/resvg-js-/] },
			routeRules: {
				"/assets/**": {
					headers: {
						"cache-control": "public, max-age=31536000, immutable",
					},
				},
				"/og.png": {
					headers: { "cache-control": "public, max-age=86400" },
				},
				"/fonts/**": {
					headers: {
						"cache-control": "public, max-age=31536000, immutable",
					},
				},
			},
		}),
		viteReact(),
		...sentryPlugins,
	],
	server: {
		// Leading dot = the domain and all its subdomains, so every fresh ngrok
		// tunnel is allowed without re-pinning the random URL on each restart.
		allowedHosts: [".ngrok-free.app", ".ngrok.app", ".trycloudflare.com"],
	},
	build: {
		rollupOptions: {
			// Server-only code (pg, pg-boss, pglite, the drizzle migrator) reaches
			// the client graph through server-function dynamic imports. Externalize
			// node builtins — both `node:`-prefixed and bare (`fs`, `path`, …) — so
			// their NAMED imports (e.g. `mkdirSync`, `setTimeout`) don't trip
			// rollup's browser-external check. This code lives in dead server chunks
			// that never execute in the browser.
			external: [/^node:/, ...builtinModules],
		},
	},
});
