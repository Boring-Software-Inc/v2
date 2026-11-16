import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

test("blocked forge cells remain explanatory actions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-forge-cell-"));
	const root = fileURLToPath(new URL("../../../../../", import.meta.url));
	const entrypoint = join(directory, "client.tsx");
	try {
		await writeFile(
			entrypoint,
			`
			import { createElement, Fragment } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { OverlayHost } from ${JSON.stringify(join(root, "packages/ui/src/overlays.tsx"))};
			import { ForgeCell } from ${JSON.stringify(fileURLToPath(new URL("./forge-cell.tsx", import.meta.url)))};

			createRoot(document.getElementById("root")).render(createElement(
				Fragment,
				null,
				createElement(ForgeCell, {
					id: "github",
					label: "GitHub",
					state: {
						body: "Refresh the page to try again.",
						kind: "blocked",
						title: "Sign-in is unavailable right now",
					},
				}),
				createElement(OverlayHost),
			));
			`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
			tsconfig: join(root, "apps/web/tsconfig.json"),
		});
		expect(build.success).toBe(true);
		const bundle = await build.outputs[0]?.text();
		if (!bundle) throw new Error("Forge cell fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://forge-cell.test/client.js") {
					await route.fulfill({
						body: bundle,
						contentType: "text/javascript",
					});
					return;
				}
				if (url === "http://forge-cell.test/") {
					await route.fulfill({
						body: '<div id="root"></div><script type="module" src="/client.js"></script>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://forge-cell.test/");
			const cell = page.getByRole("button", {
				name: "GitHub. Sign-in is unavailable right now",
			});
			expect(await cell.isEnabled()).toBe(true);
			expect(await cell.getAttribute("aria-describedby")).not.toBeNull();
			await cell.press("Enter");
			const toast = page.locator('[data-slot="toast"]');
			expect(
				await toast.getByText("Sign-in is unavailable right now").count(),
			).toBe(1);
			expect(
				await toast.getByText("Refresh the page to try again.").count(),
			).toBe(1);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
