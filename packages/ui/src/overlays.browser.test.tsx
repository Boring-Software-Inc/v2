import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

test("OverlayHost announces, dismisses, and confirms toast actions", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-overlays-"));
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const source = (file: string) =>
		JSON.stringify(join(root, "packages/ui/src", file));
	const entrypoint = join(directory, "client.tsx");

	try {
		await writeFile(
			entrypoint,
			`
			/* @jsxRuntime classic */
			import ${source("styles/theme.css")};
			import ${source("styles/base.css")};
			import ${source("styles/color.css")};
			import ${source("styles/presentational.css")};
			import ${source("styles/components.css")};
			import React, { useState } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { OverlayHost } from ${source("overlays.tsx")};
			import { notify } from ${source("toast.ts")};

			function Notifications() {
				const [removed, setRemoved] = useState(0);
				return (
					<>
						<button onClick={() => notify.show({
							title: "Preferences saved",
							description: "Your timezone was updated.",
							duration: "persistent",
						}, "success")}>Save preferences</button>
						<button onClick={() => notify.show({
							title: "Connection failed",
							description: "GitHub did not respond.",
							duration: "persistent",
						}, "error")}>Connect GitHub</button>
						<button onClick={() => notify.show({
							title: "Workspace archived",
							duration: "persistent",
							action: {
								label: "Delete workspace",
								variant: "destructive",
								confirmation: {
									title: "Delete this workspace?",
									description: "Its repositories will be disconnected.",
									confirmLabel: "Permanently delete",
								},
								onAction: () => setRemoved((count) => count + 1),
							},
						})}>Archive workspace</button>
						<output aria-label="Deleted workspaces">{removed}</output>
						<OverlayHost />
					</>
				);
			}

			createRoot(document.getElementById("root")).render(<Notifications />);
		`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		expect(build.success).toBe(true);
		const [script, styles] = await Promise.all([
			build.outputs.find((output) => output.path.endsWith(".js"))?.text(),
			build.outputs.find((output) => output.path.endsWith(".css"))?.text(),
		]);
		if (!(script && styles)) throw new Error("Overlay fixture did not build");
		const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
		const browser = await chromium.launch({ executablePath });
		try {
			const page = await browser.newPage();
			page.setDefaultTimeout(2_000);
			await page.route("http://overlays.test/**", (route) => {
				const path = new URL(route.request().url()).pathname;
				if (path === "/client.js") {
					return route.fulfill({
						body: script,
						contentType: "text/javascript",
					});
				}
				if (path === "/client.css") {
					return route.fulfill({ body: styles, contentType: "text/css" });
				}
				return route.fulfill({
					body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/client.css"><body class="tripwire"><div id="root"></div><script type="module" src="/client.js"></script>',
					contentType: "text/html",
				});
			});
			await page.goto("http://overlays.test/");
			const notifications = page.getByRole("region", { name: "Notifications" });
			const focus = page.locator(":focus");
			const dismiss = notifications.getByRole("button", {
				name: "Dismiss notification",
			});

			await page
				.getByRole("button", { name: "Save preferences" })
				.press("Enter");
			await page
				.locator('[aria-live="polite"]')
				.filter({ hasText: "Preferences saved. Your timezone was updated." })
				.waitFor({ state: "attached" });
			expect(await focus.textContent()).toBe("Save preferences");
			await page.keyboard.press("F6");
			await notifications.locator('[data-slot="toast"]').and(focus).waitFor();
			await page.keyboard.press("Tab");
			await dismiss.and(focus).waitFor();
			await page.keyboard.press("Enter");
			await notifications.waitFor({ state: "hidden" });
			expect(await focus.textContent()).toBe("Save preferences");

			await page.getByRole("button", { name: "Connect GitHub" }).press("Enter");
			await page
				.locator('[aria-live="assertive"]')
				.filter({ hasText: "Connection failed. GitHub did not respond." })
				.waitFor({ state: "attached" });
			await dismiss.press("Escape");
			await notifications.waitFor({ state: "hidden" });

			await page
				.getByRole("button", { name: "Archive workspace" })
				.press("Enter");
			const action = notifications.getByRole("button", {
				name: "Delete workspace",
			});
			const dialog = page.getByRole("alertdialog", {
				name: "Delete this workspace?",
			});
			const deleted = page.getByLabel("Deleted workspaces");
			await action.press("Enter");
			await dialog.waitFor();
			expect(await dialog.getAttribute("aria-describedby")).toBeTruthy();
			await dialog.getByRole("button", { name: "Cancel" }).and(focus).waitFor();
			expect(await deleted.textContent()).toBe("0");

			await page.keyboard.press("Escape");
			await dialog.waitFor({ state: "hidden" });
			await action.and(focus).waitFor();
			expect(await deleted.textContent()).toBe("0");

			await action.press("Enter");
			await dialog
				.getByRole("button", { name: "Permanently delete" })
				.press("Enter");
			await notifications.waitFor({ state: "hidden" });
			expect(await deleted.textContent()).toBe("1");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 15_000);
