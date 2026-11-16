import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface PopoverFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; ref: string }>;
	};
	controlledChanges: Array<{ open: boolean; source: string }>;
	openChanges: Array<{ open: boolean; source: string }>;
}

test("popovers preserve finite roles, focus, dismissal, hover, geometry, and agent control", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-popover-"));
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const entrypoint = join(directory, "client.tsx");
	try {
		await writeFile(
			entrypoint,
			`
			import ${JSON.stringify(join(root, "packages/ui/src/styles/theme.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/base.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/color.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/presentational.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/components.css"))};
			import { createAgent } from ${JSON.stringify(join(root, "node_modules/@ui-sdk/react/dist/agent.js"))};
			import { createElement, Fragment } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Popover } from ${JSON.stringify(fileURLToPath(new URL("./popover.tsx", import.meta.url)))};

			window.agent = createAgent();
			window.controlledChanges = [];
			window.openChanges = [];

			createRoot(document.getElementById("root")).render(
				createElement(Fragment, null,
					createElement("div", { id: "edge", style: { position: "fixed", right: "100px", top: "100px" } },
						createElement(Popover, {
							description: "Choose a destination.",
							onOpenChange: (open, details) => window.openChanges.push({ open, source: details.source }),
							title: "Move item",
							trigger: createElement("button", { type: "button" }, "Open actions"),
							triggerLabel: "Open actions",
						}, createElement("button", { type: "button" }, "Move here")),
					),
					createElement("div", { style: { position: "fixed", bottom: "12px", right: "100px" } },
						createElement(Popover, {
							title: "Flipped content",
							triggerLabel: "Open at bottom edge",
							trigger: createElement("button", { type: "button" }, "Open at bottom edge"),
						}, createElement("button", { type: "button" }, "Inside flipped content")),
					),
					createElement(Popover, {
						interaction: "hover",
						hoverTiming: "brief",
						trigger: createElement("button", { type: "button" }, "Preview"),
						triggerLabel: "Preview",
					}, createElement("p", null, "Preview body")),
					createElement(Popover, {
						open: false,
						onOpenChange: (open, details) => window.controlledChanges.push({ open, source: details.source }),
						trigger: createElement("button", { type: "button" }, "Controlled"),
						triggerLabel: "Controlled",
					}, "Controlled body"),
					createElement(Popover, {
						defaultOpen: true,
						trigger: createElement("button", { type: "button" }, "Menu role"),
						triggerLabel: "Menu role",
						variant: "menu",
					}, createElement("div", null, "Menu body")),
					createElement(Popover, {
						defaultOpen: true,
						trigger: createElement("button", { type: "button" }, "Panel role"),
						triggerLabel: "Panel role",
					}, createElement("div", { style: { minHeight: "1600px" } }, "Panel body")),
					createElement(Popover, {
						defaultOpen: true,
						focusMode: "trap",
						initialFocus: "first-field",
						trigger: createElement("button", { type: "button" }, "Picker role"),
						triggerLabel: "Picker role",
					}, createElement("input", { "aria-label": "Picker search" })),
					createElement(Popover, {
						initialFocus: "none",
						trigger: createElement("button", { type: "button" }, "No focus"),
						triggerLabel: "No focus",
					}, createElement("input", { "aria-label": "Ignored field" })),
					createElement(Popover, {
						finalFocus: "none",
						trigger: createElement("button", { type: "button" }, "No return"),
						triggerLabel: "No return",
					}, createElement("button", { type: "button" }, "Inside no return")),
				),
			);
			`,
		);

		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		expect(build.success).toBe(true);
		const bundle = await build.outputs
			.find((output) => output.path.endsWith(".js"))
			?.text();
		const styles = await build.outputs
			.find((output) => output.path.endsWith(".css"))
			?.text();
		if (!(bundle && styles))
			throw new Error("Popover browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const surfaceColors = new Set<string>();
			for (const viewport of [
				{ width: 390, height: 844 },
				{ width: 768, height: 900 },
				{ width: 1280, height: 900 },
				{ width: 1920, height: 1080 },
			]) {
				for (const theme of ["light", "dark"]) {
					const context = await browser.newContext({ viewport });
					await context.route("**/*", async (route) => {
						const url = route.request().url();
						if (url === "http://popover.test/client.js")
							return route.fulfill({
								body: bundle,
								contentType: "text/javascript",
							});
						if (url === "http://popover.test/client.css")
							return route.fulfill({ body: styles, contentType: "text/css" });
						if (url === "http://popover.test/")
							return route.fulfill({
								body: `<body class="tripwire" data-system="tripwire" data-theme="${theme}"><link rel="stylesheet" href="/client.css"><div id="root"></div><script type="module" src="/client.js"></script></body>`,
								contentType: "text/html",
							});
						return route.abort();
					});
					const page = await context.newPage();
					page.setDefaultTimeout(2_000);
					await page.goto("http://popover.test/");

					const menu = page
						.getByText("Menu body")
						.locator('xpath=ancestor::*[@data-slot="popover-content"]');
					const panel = page
						.getByText("Panel body")
						.locator('xpath=ancestor::*[@data-slot="popover-content"]');
					const picker = page
						.getByLabel("Picker search")
						.locator('xpath=ancestor::*[@data-slot="popover-content"]');
					await menu.waitFor();
					await panel.waitFor();
					await picker.waitFor();
					const geometry = await page.evaluate(() => {
						const menu = [
							...document.querySelectorAll<HTMLElement>(
								'[data-slot="popover-content"]',
							),
						].find((node) => node.textContent?.includes("Menu body"));
						const panel = [
							...document.querySelectorAll<HTMLElement>(
								'[data-slot="popover-content"]',
							),
						].find((node) => node.textContent?.includes("Panel body"));
						const picker = document.querySelector<HTMLElement>(
							'[data-slot="popover-content"]:has(input[aria-label="Picker search"])',
						);
						if (!(menu && panel && picker)) return null;
						const menuStyle = getComputedStyle(menu);
						const panelStyle = getComputedStyle(panel);
						return {
							backgroundColor: menuStyle.backgroundColor,
							menuPadding: menuStyle.padding,
							menuWidth: menu.getBoundingClientRect().width,
							panelPadding: panelStyle.padding,
							panelWidth: panel.getBoundingClientRect().width,
							panelRight: panel.getBoundingClientRect().right,
							panelBottom: panel.getBoundingClientRect().bottom,
							panelClientHeight: panel.clientHeight,
							panelScrollHeight: panel.scrollHeight,
							pickerOverflow: getComputedStyle(picker).overflow,
							pickerPadding: getComputedStyle(picker).padding,
							pickerWidth: picker.getBoundingClientRect().width,
							pickerScrollWidth: picker.scrollWidth,
							pickerClientWidth: picker.clientWidth,
						};
					});
					expect(geometry).not.toBeNull();
					if (geometry) surfaceColors.add(geometry.backgroundColor);
					expect(geometry?.menuPadding).toBe("0px");
					expect(geometry?.menuWidth ?? 0).toBeGreaterThan(200);
					expect(geometry?.menuWidth ?? Infinity).toBeLessThanOrEqual(288);
					expect(geometry?.panelWidth ?? 0).toBeGreaterThan(200);
					expect(geometry?.panelWidth ?? Infinity).toBeLessThanOrEqual(288);
					expect(geometry?.panelPadding).toBe("12px");
					expect(geometry?.panelScrollHeight ?? 0).toBeGreaterThan(
						geometry?.panelClientHeight ?? Infinity,
					);
					expect(geometry?.panelClientHeight ?? 0).toBeGreaterThan(370);
					expect(geometry?.pickerWidth ?? Infinity).toBeLessThanOrEqual(320);
					expect(geometry?.pickerPadding).toBe("12px");
					expect(geometry?.pickerOverflow).toBe("auto");
					expect(geometry?.pickerScrollWidth).toBe(geometry?.pickerClientWidth);
					expect(geometry?.panelRight ?? Infinity).toBeLessThanOrEqual(
						viewport.width,
					);
					expect(geometry?.panelBottom ?? Infinity).toBeLessThanOrEqual(
						viewport.height,
					);
					await context.close();
				}
			}
			expect(surfaceColors.size).toBe(2);

			const context = await browser.newContext({
				viewport: { width: 1280, height: 900 },
			});
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://popover.test/client.js")
					return route.fulfill({
						body: bundle,
						contentType: "text/javascript",
					});
				if (url === "http://popover.test/client.css")
					return route.fulfill({ body: styles, contentType: "text/css" });
				if (url === "http://popover.test/")
					return route.fulfill({
						body: '<body class="tripwire" data-system="tripwire" data-theme="dark"><link rel="stylesheet" href="/client.css"><div id="root"></div><script type="module" src="/client.js"></script></body>',
						contentType: "text/html",
					});
				return route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://popover.test/");
			const pickerSearch = page.getByLabel("Picker search");
			const pickerTrigger = page.getByRole("button", { name: "Picker role" });
			await pickerTrigger.click();
			await pickerSearch.waitFor({ state: "detached" });
			await pickerTrigger.click();
			await pickerSearch.waitFor();
			expect(
				await pickerSearch.evaluate((node) => node === document.activeElement),
			).toBe(true);
			await page.keyboard.press("Tab");
			expect(
				await pickerSearch.evaluate((node) => node === document.activeElement),
			).toBe(true);
			const trigger = page.getByRole("button", { name: "Open actions" });
			await trigger.click();
			const dialog = page.getByRole("dialog", { name: "Move item" });
			await dialog.waitFor();
			await page.waitForTimeout(220);
			const contract = await dialog.evaluate((node) => {
				const surface = node as HTMLElement;
				const trigger = document.querySelector<HTMLElement>(
					'button[aria-label="Open actions"]',
				);
				const title = surface.querySelector<HTMLElement>(
					'[data-slot="popover-title"]',
				);
				const body = surface.querySelector<HTMLElement>(
					'[data-slot="popover-body"]',
				);
				if (!(trigger && title && body)) return null;
				const triggerRect = trigger.getBoundingClientRect();
				const surfaceRect = surface.getBoundingClientRect();
				const side = surface.dataset.side;
				const gap =
					side === "top"
						? triggerRect.top - surfaceRect.bottom
						: side === "bottom"
							? surfaceRect.top - triggerRect.bottom
							: side === "left"
								? triggerRect.left - surfaceRect.right
								: surfaceRect.left - triggerRect.right;
				const style = getComputedStyle(surface);
				return {
					bodyDisplay: getComputedStyle(body).display,
					bodyGap: getComputedStyle(body).gap,
					gap,
					side,
					titleFontSize: getComputedStyle(title).fontSize,
					transitionDuration: style.transitionDuration,
					transitionProperty: style.transitionProperty,
				};
			});
			expect(contract).not.toBeNull();
			expect(contract?.side).toBe("bottom");
			expect(Math.round(contract?.gap ?? 0)).toBe(6);
			expect(contract?.titleFontSize).toBe("13px");
			expect(contract?.bodyDisplay).toBe("flex");
			expect(contract?.bodyGap).toBe("12px");
			expect(contract?.transitionDuration).toContain("0.2s");
			expect(contract?.transitionProperty).toContain("translate");
			expect(await trigger.getAttribute("aria-expanded")).toBe("true");
			expect(await dialog.getByText("Choose a destination.").count()).toBe(1);
			expect(
				await page
					.getByRole("button", { name: "Move here" })
					.evaluate((node) => node === document.activeElement),
			).toBe(true);
			await page.keyboard.press("Escape");
			await page.waitForTimeout(80);
			const exitContract = await dialog.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					duration: style.transitionDuration,
					side: node.getAttribute("data-side"),
					timing: style.transitionTimingFunction,
					translate: style.translate,
				};
			});
			expect(exitContract).toMatchObject({
				duration: expect.stringContaining("0.16s"),
				timing: expect.stringContaining("cubic-bezier(0.4, 0, 1, 1)"),
				side: "bottom",
			});
			expect(
				Number.parseFloat(exitContract.translate.split(" ").at(-1) ?? "0"),
			).toBeLessThan(-0.5);
			await dialog.waitFor({ state: "detached" });
			expect(
				await trigger.evaluate((node) => node === document.activeElement),
			).toBe(true);

			await page.getByRole("button", { name: "Open at bottom edge" }).click();
			const flipped = page.locator('[data-slot="popover-content"]').filter({
				hasText: "Flipped content",
			});
			await flipped.waitFor();
			await page.waitForTimeout(220);
			expect(await flipped.getAttribute("data-side")).toBe("top");
			await page.keyboard.press("Escape");
			const flippedShift = await flipped.evaluate(async (node) => {
				await new Promise(requestAnimationFrame);
				const value = node
					.getAnimations()
					.find(
						(animation) =>
							animation instanceof CSSTransition &&
							animation.transitionProperty === "translate",
					)?.effect;
				return value instanceof KeyframeEffect
					? value.getKeyframes().at(-1)?.translate
					: undefined;
			});
			expect(flippedShift).toBe("0px 4px");
			await flipped.waitFor({ state: "detached" });

			const noReturn = page.getByRole("button", { name: "No return" });
			await noReturn.click();
			await page.getByRole("button", { name: "Inside no return" }).focus();
			await page.keyboard.press("Escape");
			expect(
				await noReturn.evaluate((node) => node === document.activeElement),
			).toBe(false);
			await trigger.focus();
			await trigger.press(" ");
			await dialog.waitFor();
			await page.mouse.click(400, 700);
			await dialog.waitFor({ state: "detached" });
			expect(
				await page.evaluate(() =>
					(window as unknown as PopoverFixtureWindow).openChanges.map(
						(change) => change.source,
					),
				),
			).toContain("keyboard");

			const controlled = page.getByRole("button", { name: "Controlled" });
			await controlled.click();
			expect(await page.getByText("Controlled body").count()).toBe(0);
			expect(
				await page.evaluate(() =>
					(window as unknown as PopoverFixtureWindow).controlledChanges.at(-1),
				),
			).toEqual({ open: true, source: "mouse" });

			const noFocus = page.getByRole("button", { name: "No focus" });
			await noFocus.focus();
			await noFocus.press("Enter");
			await page.getByLabel("Ignored field").waitFor();
			expect(
				await noFocus.evaluate((node) => node === document.activeElement),
			).toBe(true);
			await page.keyboard.press("Escape");

			const preview = page.getByRole("button", { name: "Preview" });
			await controlled.focus();
			await preview.hover();
			await page.waitForTimeout(180);
			await page.getByText("Preview body").waitFor();
			expect(
				await controlled.evaluate((node) => node === document.activeElement),
			).toBe(true);
			await preview.click();
			await page.getByRole("button", { name: "Close preview" }).waitFor();
			await page.mouse.move(600, 600);
			await page.waitForTimeout(200);
			expect(await page.getByText("Preview body").count()).toBe(1);
			await page.getByRole("button", { name: "Close preview" }).click();
			await page.getByText("Preview body").waitFor({ state: "detached" });

			const agentResult = await page.evaluate(async () => {
				const fixture = window as unknown as PopoverFixtureWindow;
				const popover = fixture.agent
					.snapshot()
					.find((entry) => entry.component === "popover");
				if (!popover) throw new Error("Popover was not exposed to the agent");
				const opened = await fixture.agent.act({
					steps: [{ action: "setOpen", args: [true], ref: popover.ref }],
				});
				const closed = await fixture.agent.act({
					steps: [{ action: "setOpen", args: [false], ref: popover.ref }],
				});
				return {
					closed,
					opened,
					sources: fixture.openChanges.map((change) => change.source),
				};
			});
			expect(agentResult.opened.ok).toBe(true);
			expect(agentResult.closed.ok).toBe(true);
			expect(agentResult.sources).toContain("agent");

			await page.getByRole("button", { name: "Menu role" }).click();
			const menuSurface = page
				.getByText("Menu body")
				.locator('xpath=ancestor::*[@data-slot="popover-content"]');
			expect(
				await menuSurface.evaluate(
					(node) => getComputedStyle(node).transitionDuration,
				),
			).not.toBe("0s");
			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "reduce",
			});
			const adaptedSurface = await menuSurface.evaluate((node) => {
				const style = getComputedStyle(node);
				return {
					borderColor: style.borderColor,
					borderStyle: style.borderStyle,
					transitionDuration: style.transitionDuration,
				};
			});
			expect(adaptedSurface.borderStyle).toBe("solid");
			expect(adaptedSurface.borderColor).not.toBe("transparent");
			expect(adaptedSurface.transitionDuration).toBe("0s");
			await context.close();
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 20_000);
