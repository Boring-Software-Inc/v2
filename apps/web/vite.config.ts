import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [
		tsconfigPaths({ projects: ["./tsconfig.json"] }),
		tailwindcss(),
		tanstackStart(),
		nitro(),
		viteReact(),
	],
	server: {
		// Leading dot = the domain and all its subdomains, so every fresh ngrok
		// tunnel is allowed without re-pinning the random URL on each restart.
		allowedHosts: [".ngrok-free.app", ".ngrok.app", ".trycloudflare.com"],
	},
});
