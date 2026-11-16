import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

test("Drawer keeps the sheet insets, modal focus and protected dismissal", async () => {
	const path = (relative: string) =>
		JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)));
	const bundle = await Bun.build({
		entrypoints: ["drawer-fixture.ts"],
		files: {
			"drawer-fixture.ts": `
				import ${path("./styles/theme.css")};
				import ${path("./styles/base.css")};
				import ${path("./styles/color.css")};
				import ${path("./styles/components.css")};
				import { createRoot } from ${path("../../../node_modules/react-dom/client.js")};
				import { createElement as h } from ${path("../../../node_modules/react/index.js")};
				import { createAgent } from ${path("../../../node_modules/@ui-sdk/react/dist/agent.js")};
				import { Drawer } from ${path("./drawer.tsx")};
				window.drawerAgent = createAgent();
				const cases = [
					{ side: "right", title: "Edit response" },
					{ side: "left", title: "Review user", bodyInset: "content", dismissible: false },
					{ side: "bottom", title: "Filters" },
				];
				createRoot(document.querySelector("#root")).render(cases.map((props) =>
					h(Drawer, {
						...props, key: props.title,
						onOpenChange: (_, details) => document.body.dataset.drawerSource = details.source,
						trigger: h("button", { type: "button" }, "Open " + props.title),
					}, h("input", { "aria-label": "Filter text" }))));
			`,
		},
	});
	const js = await bundle.outputs
		.find((file) => file.path.endsWith(".js"))
		?.text();
	const css = await bundle.outputs
		.find((file) => file.path.endsWith(".css"))
		?.text();
	if (!(js && css)) throw new Error("Drawer fixture did not bundle");
	const browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	});
	try {
		const page = await browser.newPage({
			reducedMotion: "reduce",
			viewport: { width: 390, height: 640 },
		});
		page.setDefaultTimeout(2_000);
		await page.route("**/*", (route) =>
			new URL(route.request().url()).pathname === "/client.js"
				? route.fulfill({ body: js, contentType: "text/javascript" })
				: route.fulfill({
						body: `<!doctype html><style>${css}</style><body class="tripwire" data-system="tripwire"><div id="root"></div><script type="module" src="/client.js"></script>`,
						contentType: "text/html",
					}),
		);
		await page.goto("http://drawer.test");
		for (const title of ["Edit response", "Review user", "Filters"]) {
			const trigger = page.getByRole("button", { name: `Open ${title}` });
			await trigger.press("Enter");
			const dialog = page.getByRole("dialog", { name: title });
			await dialog.waitFor();
			expect(await dialog.getAttribute("aria-modal")).toBe("true");
			expect(
				await page.locator('[data-slot="drawer-backdrop"]:visible').count(),
			).toBe(1);
			expect(
				await dialog
					.locator('[data-slot="drawer-panel"]')
					.evaluate((node) => getComputedStyle(node).borderTopWidth),
			).toBe("1px");
			const box = await dialog.boundingBox();
			if (!box) throw new Error("Drawer has no geometry");
			expect(box.x).toBeGreaterThanOrEqual(8);
			expect(box.x + box.width).toBeLessThanOrEqual(382);
			if (title === "Filters") expect(box.y + box.height).toBe(632);
			if (title === "Filters")
				expect(
					await dialog.getByRole("button", { name: "Resize drawer" }).count(),
				).toBe(1);
			const body = dialog.locator('[data-slot="dialog-body"]');
			expect(
				await body.evaluate((node) => getComputedStyle(node).padding),
			).toBe(title === "Review user" ? "0px" : "16px");
			for (let i = 0; i < 4; i++) {
				await page.keyboard.press("Tab");
				expect(
					await dialog.evaluate((node) =>
						node.contains(document.activeElement),
					),
				).toBe(true);
			}
			if (title === "Review user") {
				await page.keyboard.press("Escape");
				expect(await dialog.isVisible()).toBe(true);
			}
			const close = dialog.getByRole("button", { name: "Close" });
			expect(await close.getAttribute("data-variant")).toBe("secondary");
			if (title === "Edit response")
				expect(
					await dialog.evaluate((node) =>
						node
							.getAnimations()
							.every(
								(animation) =>
									!(animation.effect instanceof KeyframeEffect) ||
									animation.effect
										.getKeyframes()
										.every((frame) => !("translate" in frame)),
							),
					),
				).toBe(true);
			await close.click();
			await dialog.waitFor({ state: "hidden" });
			expect(
				await trigger.evaluate((node) => document.activeElement === node),
			).toBe(true);
		}
		const agentOpened = await page.evaluate(async () => {
			const agent = Reflect.get(window, "drawerAgent") as {
				snapshot(): Array<{ component: string; ref: string }>;
				act(input: {
					steps: Array<{ action: string; args: boolean[]; ref: string }>;
				}): Promise<{ ok: boolean }>;
			};
			const drawer = agent
				.snapshot()
				.find(({ component }) => component === "drawer");
			if (!drawer) throw new Error("Drawer missing from agent snapshot");
			return (
				await agent.act({
					steps: [{ action: "setOpen", args: [true], ref: drawer.ref }],
				})
			).ok;
		});
		expect(agentOpened).toBe(true);
		await page.getByRole("dialog").waitFor();
		expect(await page.locator("body").getAttribute("data-drawer-source")).toBe(
			"agent",
		);
		await page
			.getByRole("dialog")
			.getByRole("button", { name: "Close" })
			.click();
		await page.getByRole("dialog").waitFor({ state: "hidden" });
		await page.emulateMedia({
			forcedColors: "active",
			reducedMotion: "reduce",
		});
		await page.getByRole("button", { name: "Open Edit response" }).click();
		expect(
			await page
				.getByRole("dialog")
				.evaluate((node) => getComputedStyle(node).outlineStyle),
		).toBe("solid");
	} finally {
		await browser.close();
	}
});
