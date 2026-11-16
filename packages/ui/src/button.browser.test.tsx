import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface ButtonFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	allowDestructive: boolean;
	actions: string[];
	destructiveCount: number;
	formEntries: Array<[string, string]>;
	navigations: string[];
	resolveAction: () => void;
}

test("buttons share one executable action, navigation, pending, and confirmation contract", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-button-"));
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
			import { ActionLink, Button, IconButton } from ${JSON.stringify(fileURLToPath(new URL("./button.tsx", import.meta.url)))};
			import { OverlayHost } from ${JSON.stringify(fileURLToPath(new URL("./overlays.tsx", import.meta.url)))};

			window.actions = [];
			window.allowDestructive = false;
			window.destructiveCount = 0;
			window.formEntries = [];
			window.navigations = [];
			window.resolveAction = () => undefined;
			window.agent = createAgent({ allow: (action) => action.confirm ? window.allowDestructive : true });
			const save = (details) => {
				window.actions.push(details.source);
				return new Promise((resolve) => { window.resolveAction = resolve; });
			};
			createRoot(document.getElementById("root")).render(createElement(
				"main",
				{ className: "tripwire" },
				createElement(Button, {
					onAction: save,
					pendingLabel: "Saving",
				}, "Save"),
				createElement(Button, {
					leadingIcon: createElement("svg", { viewBox: "0 0 16 16" }, createElement("path", { d: "M2 8h12" })),
					onAction: (details) => window.actions.push("immediate:" + details.source),
					variant: "primary",
				}, "Run now"),
				createElement(Button, {
					leadingIcon: createElement("svg", { viewBox: "0 0 16 16" }, createElement("path", { d: "M2 8h12" })),
					size: "small",
					variant: "ghost",
				}, "Small ghost"),
				createElement(Button, { size: "large" }, "Large secondary"),
				createElement(Button, { onAction: save, reservePendingWidth: true, pendingLabel: "Finishing sign-in" }, "Sign in"),
				createElement(Button, { disabled: true }, "Disabled"),
				createElement(Button, {
					describedBy: "locked-hint",
					disabled: true,
					focusableWhenDisabled: true,
					onAction: (details) => window.actions.push("focusable-disabled:" + details.source),
				}, "Focusable disabled"),
				createElement("p", { id: "locked-hint" }, "Complete setup first."),
				createElement(Button, {
					confirmation: {
						confirmLabel: "Delete",
						description: "This cannot be undone.",
						title: "Delete workspace?",
					},
					onAction: () => { window.destructiveCount += 1; },
					variant: "destructive",
				}, "Delete"),
				createElement(Button, {
					href: "/settings",
					onNavigate: (href, details) => window.navigations.push(href + ":" + details.source),
				}, "Settings"),
				createElement(ActionLink, {
					href: "https://example.com/preview",
					onNavigate: (href, details) => window.navigations.push(href + ":" + details.source),
					openInNewTab: true,
				}, "Preview portal"),
				createElement(ActionLink, { href: "/small", size: "small" }, "Small link"),
				createElement(ActionLink, { href: "/large", size: "large" }, "Large link"),
				createElement(IconButton, {
					icon: createElement("svg", { viewBox: "0 0 16 16" }, createElement("path", { d: "M3 3l10 10M13 3L3 13" })),
					label: "Close panel",
					size: "small",
				}),
				createElement("form", {
					id: "button-form",
					onSubmit: (event) => {
						event.preventDefault();
						window.formEntries = [...new FormData(event.currentTarget, event.nativeEvent.submitter).entries()];
					},
				},
					createElement("input", { defaultValue: "initial", name: "title" }),
				),
				createElement(Button, {
					form: "button-form",
					name: "intent",
					type: "submit",
					value: "save",
				}, "Submit external form"),
				createElement(Button, { form: "button-form", type: "reset" }, "Reset external form"),
				createElement(OverlayHost),
			));
			`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		expect(build.success).toBe(true);
		const scriptOutput = build.outputs.find((output) =>
			output.path.endsWith(".js"),
		);
		const styleOutput = build.outputs.find((output) =>
			output.path.endsWith(".css"),
		);
		const bundle = await scriptOutput?.text();
		const styles = await styleOutput?.text();
		if (!(bundle && styles))
			throw new Error("Button browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://button.test/client.js") {
					await route.fulfill({
						body: bundle,
						contentType: "text/javascript",
					});
					return;
				}
				if (url === "http://button.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://button.test/") {
					await route.fulfill({
						body: '<link rel="stylesheet" href="/client.css"><div id="root"></div><script type="module" src="/client.js"></script>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://button.test/");
			const save = page.locator('[data-slot="button"]').first();
			const signIn = page.getByRole("button", { name: "Sign in", exact: true });
			const reservedWidth = await signIn.evaluate(
				(element) => element.getBoundingClientRect().width,
			);
			await signIn.press("Enter");
			expect(await signIn.getAttribute("aria-busy")).toBe("true");
			const pendingAccessibleTree = await signIn.ariaSnapshot();
			expect(pendingAccessibleTree).toContain('button "Sign in"');
			expect(pendingAccessibleTree).not.toContain("Finishing sign-in");
			expect(
				await signIn.evaluate((element) => element === document.activeElement),
			).toBe(true);
			expect(await signIn.getByText("Finishing sign-in").isVisible()).toBe(
				true,
			);
			expect(
				await signIn.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBe(reservedWidth);
			await page.evaluate(() => {
				const fixture = window as unknown as ButtonFixtureWindow;
				fixture.resolveAction();
				fixture.actions.length = 0;
			});
			await page.waitForFunction(
				() =>
					document
						.querySelector('[data-slot="button-state-stack"]')
						?.parentElement?.hasAttribute("data-pending") === false,
			);
			expect(await signIn.getByText("Finishing sign-in").isVisible()).toBe(
				false,
			);
			expect(
				await signIn.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBe(reservedWidth);

			const actionCount = () =>
				page.evaluate<number>(
					() => (window as unknown as ButtonFixtureWindow).actions.length,
				);

			await save.click();
			expect(await save.getAttribute("data-pending")).not.toBeNull();
			expect(await save.getAttribute("aria-busy")).toBe("true");
			expect(
				await save.evaluate((element) => document.activeElement === element),
			).toBe(true);
			await save.click({ force: true });
			await page.keyboard.press("Enter");
			expect(await actionCount()).toBe(1);
			const pendingAgentResult = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as ButtonFixtureWindow;
				const pending = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Saving");
				if (!pending) throw new Error("Pending button was not exposed");
				return fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: pending.ref }],
				});
			});
			expect(pendingAgentResult.ok).toBe(false);
			expect(await actionCount()).toBe(1);
			await page.evaluate(() =>
				(window as unknown as ButtonFixtureWindow).resolveAction(),
			);
			await page.waitForFunction(
				() =>
					document
						.querySelector('[data-slot="button"]')
						?.hasAttribute("data-pending") === false,
			);
			expect(await save.getAttribute("data-pending")).toBeNull();

			await save.press("Enter");
			expect(await actionCount()).toBe(2);
			await page.evaluate(() =>
				(window as unknown as ButtonFixtureWindow).resolveAction(),
			);
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as ButtonFixtureWindow).actions,
				),
			).toEqual(["mouse", "keyboard"]);

			const destructive = page.getByRole("button", { name: "Delete" });
			const confirmation = page.getByRole("alertdialog", {
				name: "Delete workspace?",
			});
			await destructive.click();
			await confirmation.getByRole("button", { name: "Cancel" }).click();
			expect(
				await page.evaluate<number>(
					() => (window as unknown as ButtonFixtureWindow).destructiveCount,
				),
			).toBe(0);
			await destructive.press("Enter");
			await confirmation.getByRole("button", { name: "Delete" }).click();
			expect(
				await page.evaluate<number>(
					() => (window as unknown as ButtonFixtureWindow).destructiveCount,
				),
			).toBe(1);

			const navigation = page.getByRole("link", { name: "Settings" });
			expect(await navigation.getAttribute("href")).toBe("/settings");
			await navigation.click();
			await navigation.press("Enter");
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as ButtonFixtureWindow).navigations,
				),
			).toEqual(["/settings:mouse", "/settings:keyboard"]);

			const external = page.getByRole("link", { name: "Preview portal" });
			expect(await external.getAttribute("target")).toBe("_blank");
			expect(await external.getAttribute("rel")).toBe("noreferrer");
			expect(await save.getAttribute("type")).toBe("button");

			const formInput = page.locator('#button-form input[name="title"]');
			await formInput.fill("changed");
			await page.getByRole("button", { name: "Reset external form" }).click();
			expect(await formInput.inputValue()).toBe("initial");
			const submit = page.getByRole("button", { name: "Submit external form" });
			expect(await submit.getAttribute("form")).toBe("button-form");
			expect(await submit.getAttribute("type")).toBe("submit");
			await submit.click();
			expect(
				await page.evaluate<Array<[string, string]>>(
					() => (window as unknown as ButtonFixtureWindow).formEntries,
				),
			).toEqual([
				["title", "initial"],
				["intent", "save"],
			]);
			expect(
				await page.getByRole("button", { name: "Close panel" }).count(),
			).toBe(1);

			const primary = page.getByRole("button", { name: "Run now" });
			const small = page.getByRole("button", { name: "Small ghost" });
			const large = page.getByRole("button", { name: "Large secondary" });
			const smallLink = page.getByRole("link", { name: "Small link" });
			const largeLink = page.getByRole("link", { name: "Large link" });
			const iconButton = page.getByRole("button", { name: "Close panel" });
			expect(
				await iconButton.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBe(26);
			expect(
				await save.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(32);
			expect(
				await small.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(26);
			expect(
				await large.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(36);
			expect(
				await external.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(32);
			expect(
				await smallLink.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(26);
			expect(
				await largeLink.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(36);
			expect(
				await iconButton.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(26);
			expect(
				await primary
					.locator("svg")
					.evaluate((element) => element.getBoundingClientRect().width),
			).toBe(14);
			expect(
				await small
					.locator("svg")
					.evaluate((element) => element.getBoundingClientRect().width),
			).toBe(12);
			expect(
				await page
					.getByRole("button", { name: "Close panel" })
					.locator("svg")
					.evaluate((element) => element.getBoundingClientRect().width),
			).toBe(12);

			const disabled = page.getByRole("button", {
				name: "Disabled",
				exact: true,
			});
			await disabled.focus();
			expect(
				await disabled.evaluate(
					(element) => document.activeElement === element,
				),
			).toBe(false);
			const focusableDisabled = page.getByRole("button", {
				name: "Focusable disabled",
			});
			await focusableDisabled.focus();
			expect(
				await focusableDisabled.evaluate(
					(element) => document.activeElement === element,
				),
			).toBe(true);
			expect(await focusableDisabled.getAttribute("aria-disabled")).toBe(
				"true",
			);
			expect(await focusableDisabled.getAttribute("aria-describedby")).toBe(
				"locked-hint",
			);
			const actionsBeforeDisabled = await actionCount();
			await focusableDisabled.click({ force: true });
			await focusableDisabled.press("Enter");
			expect(await actionCount()).toBe(actionsBeforeDisabled);

			await primary.focus();
			expect(
				await primary.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).not.toBe("none");
			const lightPrimary = await primary.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.color];
			});
			const lightSecondary = await save.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.borderColor, style.color];
			});
			const lightLink = await external.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.borderColor, style.color];
			});
			const lightIcon = await iconButton.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.borderColor, style.color];
			});
			await save.hover();
			await page.waitForTimeout(200);
			expect(
				await save.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).not.toBe(lightSecondary[0]);
			await external.focus();
			expect(
				await external.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).not.toBe("none");
			await external.hover();
			await page.waitForTimeout(200);
			expect(
				await external.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).not.toBe(lightLink[0]);
			const lightDestructive = await destructive.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.borderColor, style.color];
			});
			await page
				.locator("main.tripwire")
				.evaluate((element) => element.setAttribute("data-theme", "dark"));
			await page.waitForTimeout(50);
			expect(
				await primary.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.color];
				}),
			).not.toEqual(lightPrimary);
			expect(
				await save.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.borderColor, style.color];
				}),
			).not.toEqual(lightSecondary);
			expect(
				await destructive.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.borderColor, style.color];
				}),
			).not.toEqual(lightDestructive);
			expect(
				await external.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.borderColor, style.color];
				}),
			).not.toEqual(lightLink);
			expect(
				await iconButton.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.borderColor, style.color];
				}),
			).not.toEqual(lightIcon);

			await page.emulateMedia({ reducedMotion: "reduce" });
			expect(
				await primary.evaluate((element) =>
					getComputedStyle(element)
						.transitionDuration.split(",")
						.every((duration) => Number.parseFloat(duration) === 0),
				),
			).toBe(true);
			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "no-preference",
			});
			expect(
				await primary.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await destructive.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await external.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await iconButton.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			await page.emulateMedia({ forcedColors: "none" });

			const agentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as ButtonFixtureWindow;
				const components = fixtureWindow.agent.snapshot();
				const immediate = components.find(
					(component) => component.label === "Run now",
				);
				const destructive = components.find(
					(component) => component.label === "Delete",
				);
				const disabled = components.find(
					(component) => component.label === "Disabled",
				);
				const focusableDisabled = components.find(
					(component) => component.label === "Focusable disabled",
				);
				const navigation = components.find(
					(component) => component.label === "Settings",
				);
				const actionLink = components.find(
					(component) => component.label === "Preview portal",
				);
				if (
					!immediate ||
					!destructive ||
					!disabled ||
					!focusableDisabled ||
					!navigation ||
					!actionLink
				)
					throw new Error(JSON.stringify(components));
				const pressed = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: immediate.ref }],
				});
				const refused = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: destructive.ref }],
				});
				const disabledPress = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: disabled.ref }],
				});
				const focusableDisabledPress = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: focusableDisabled.ref }],
				});
				const navigated = await fixtureWindow.agent.act({
					steps: [{ action: "open", args: [], ref: navigation.ref }],
				});
				const actionLinkNavigated = await fixtureWindow.agent.act({
					steps: [{ action: "open", args: [], ref: actionLink.ref }],
				});
				fixtureWindow.allowDestructive = true;
				const accepted = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: destructive.ref }],
				});
				return [
					pressed,
					refused,
					disabledPress,
					focusableDisabledPress,
					navigated,
					actionLinkNavigated,
					accepted,
				];
			});
			expect(agentResults.map((result) => result.ok)).toEqual([
				true,
				false,
				false,
				false,
				true,
				true,
				true,
			]);
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as ButtonFixtureWindow).actions,
				),
			).toContain("immediate:agent");
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as ButtonFixtureWindow).navigations,
				),
			).toEqual([
				"/settings:mouse",
				"/settings:keyboard",
				"/settings:agent",
				"https://example.com/preview:agent",
			]);
			expect(
				await page.evaluate<number>(
					() => (window as unknown as ButtonFixtureWindow).destructiveCount,
				),
			).toBe(2);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
