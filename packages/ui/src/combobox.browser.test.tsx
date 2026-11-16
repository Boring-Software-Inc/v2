import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface ComboboxFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	controlledChanges: Array<{ source: string; value: string | null }>;
	controlledOpenChanges: Array<{ open: boolean; source: string }>;
	controlledQueryChanges: Array<{ query: string; source: string }>;
	created: Array<{ query: string; source: string }>;
	externalChanges: Array<{ source: string; value: string[] }>;
	multipleChanges: Array<{ source: string; value: string[] }>;
	objectChanges: Array<{ source: string; value: string[] }>;
	openChanges: Array<{ open: boolean; source: string }>;
	queryChanges: Array<{ query: string; source: string }>;
	valueChanges: Array<{ source: string; value: string | null }>;
}

test("comboboxes share query, selection, creation, controlled, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-comboboxes-"));
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
			import { createElement, Fragment, useState } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Combobox } from ${JSON.stringify(fileURLToPath(new URL("./combobox.tsx", import.meta.url)))};

			window.controlledChanges = [];
			window.controlledOpenChanges = [];
			window.controlledQueryChanges = [];
			window.created = [];
			window.externalChanges = [];
			window.multipleChanges = [];
			window.openChanges = [];
			window.queryChanges = [];
			window.valueChanges = [];
			window.objectChanges = [];
			window.agent = createAgent({ allow: () => true });
			const options = [
				{ description: "First option", label: "Alpha", value: "alpha" },
				{ description: "Unavailable", disabled: true, label: "Locked", value: "locked" },
				{ description: "Second option", label: "Beta", value: "beta" },
				{ description: "A deliberately long supporting description that must remain inside the popup", label: "A deliberately long option label that must truncate", value: "long" },
			];
			const objectOptions = [
				{ id: "one", label: "One", value: { id: "one", label: "One" } },
				{ id: "two", label: "Two", value: { id: "two", label: "Two" } },
			];
			function ObjectCombobox() {
				const [value, setValue] = useState([
					{ id: "one", label: "One" },
					{ id: "two", label: "Two" },
				]);
				return createElement(Fragment, null,
					createElement(Combobox, {
						ariaLabel: "Object choices",
						isItemEqualToValue: (item, selected) => item.id === selected.id,
						itemToLabel: (item) => item.label,
						itemToValue: (item) => item.id,
						multiple: true,
						onValueChange: (next, details) => {
							window.objectChanges.push({ source: details.source, value: next.map((item) => item.id) });
							setValue(next);
						},
						options: objectOptions,
						value,
					}),
					createElement("button", {
						onClick: () => setValue((current) => [...current].reverse()),
						type: "button",
					}, "Reverse object values"),
				);
			}
			createRoot(document.getElementById("root")).render(createElement(
				"main",
				{ className: "tripwire" },
				createElement(Combobox, {
					ariaLabel: "Primary choice",
					disclosureLabel: "Show primary options",
					onOpenChange: (open, details) => window.openChanges.push({ open, source: details.source }),
					onQueryChange: (query, details) => window.queryChanges.push({ query, source: details.source }),
					onValueChange: (value, details) => window.valueChanges.push({ source: details.source, value }),
					options,
					placeholder: "Choose one",
				}),
				createElement(Combobox, {
					ariaLabel: "Multiple choices",
					defaultValue: ["alpha"],
					multiple: true,
					onValueChange: (value, details) => window.multipleChanges.push({ source: details.source, value }),
					options,
					valueTone: (value) => value === "beta" ? "warning" : "default",
				}),
				createElement(Combobox, {
					ariaLabel: "Controlled choice",
					onValueChange: (value, details) => window.controlledChanges.push({ source: details.source, value }),
					options,
					value: "alpha",
				}),
				createElement(Combobox, {
					ariaLabel: "Controlled query",
					onOpenChange: (open, details) => window.controlledOpenChanges.push({ open, source: details.source }),
					onQueryChange: (query, details) => window.controlledQueryChanges.push({ query, source: details.source }),
					open: false,
					options,
					query: "fixed",
				}),
				createElement(Combobox, {
					ariaLabel: "Disabled choice",
					disabled: true,
					form: "combobox-form",
					name: "disabled-choice",
					options,
				}),
				createElement(Combobox, {
					ariaLabel: "Read-only choice",
					defaultValue: "beta",
					form: "combobox-form",
					itemToLabel: (value) => options.find((option) => option.value === value)?.label ?? value,
					name: "read-only-choice",
					onQueryChange: (query, details) => window.queryChanges.push({ query, source: details.source }),
					onValueChange: (value, details) => window.valueChanges.push({ source: details.source, value }),
					options,
					readOnly: true,
				}),
				createElement(Combobox, {
					ariaLabel: "Form choice",
					defaultValue: "beta",
					form: "combobox-form",
					itemToLabel: (value) => options.find((option) => option.value === value)?.label ?? value,
					name: "form-choice",
					onValueChange: (value, details) => window.valueChanges.push({ source: details.source, value }),
					options,
					required: true,
				}),
				createElement(Combobox, {
					ariaLabel: "External choices",
					defaultValue: ["alpha", "beta"],
					form: "external-form",
					itemToLabel: (value) => options.find((option) => option.value === value)?.label ?? value,
					multiple: true,
					name: "external-choice",
					onValueChange: (value, details) => window.externalChanges.push({ source: details.source, value }),
					options,
				}),
				createElement(Combobox, {
					ariaLabel: "Inline choice",
					options,
					variant: "inline",
				}),
				createElement("div", { style: { inlineSize: "180px" } },
					createElement(Combobox, {
						ariaLabel: "Narrow choice",
						options,
					}),
				),
				createElement(Combobox, {
					allowCustomValue: true,
					ariaLabel: "Create choice",
					createLabel: (query) => "Create " + query,
					onCreate: (query, details) => window.created.push({ query, source: details.source }),
					options,
				}),
				createElement(ObjectCombobox),
				createElement("form", { id: "combobox-form", onSubmit: (event) => event.preventDefault() },
					createElement("button", { type: "reset" }, "Reset combobox form"),
					createElement("button", { type: "submit" }, "Submit combobox form"),
				),
				createElement("form", { id: "external-form" }),
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
			throw new Error("Combobox browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://comboboxes.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://comboboxes.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://comboboxes.test/") {
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
			await page.goto("http://comboboxes.test/");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as ComboboxFixtureWindow;
					return {
						controlledChanges: value.controlledChanges,
						controlledOpenChanges: value.controlledOpenChanges,
						controlledQueryChanges: value.controlledQueryChanges,
						created: value.created,
						externalChanges: value.externalChanges,
						multipleChanges: value.multipleChanges,
						objectChanges: value.objectChanges,
						openChanges: value.openChanges,
						queryChanges: value.queryChanges,
						valueChanges: value.valueChanges,
					};
				});

			const primary = page.getByRole("combobox", { name: "Primary choice" });
			const disclosure = page.getByRole("button", {
				name: "Show primary options",
			});
			expect(await disclosure.getAttribute("tabindex")).toBe("-1");
			expect(await disclosure.getAttribute("aria-expanded")).toBe("false");
			await disclosure.click();
			expect(await disclosure.getAttribute("aria-expanded")).toBe("true");
			expect(
				await primary.evaluate((element) => document.activeElement === element),
			).toBe(true);
			await primary.press("Escape");
			expect(await disclosure.getAttribute("aria-expanded")).toBe("false");
			await primary.focus();
			await primary.pressSequentially("be");
			expect(
				(await fixture()).openChanges.some(
					(change) => change.open && change.source === "keyboard",
				),
			).toBe(true);
			expect((await fixture()).queryChanges.at(-1)).toEqual({
				query: "be",
				source: "keyboard",
			});
			expect(await page.getByRole("option", { name: /Beta/ }).count()).toBe(1);
			expect(await page.getByRole("option", { name: /Alpha/ }).count()).toBe(0);
			await primary.press("ArrowDown");
			await primary.press("Enter");
			expect(await primary.inputValue()).toBe("Beta");
			expect((await fixture()).valueChanges.at(-1)).toEqual({
				source: "keyboard",
				value: "beta",
			});

			await primary.click();
			expect((await fixture()).openChanges.at(-1)).toEqual({
				open: true,
				source: "mouse",
			});
			await primary.press("Control+A");
			await primary.press("Backspace");
			await page.getByRole("option", { name: /Alpha/ }).click();
			expect(await primary.inputValue()).toBe("Alpha");
			expect((await fixture()).valueChanges.at(-1)).toEqual({
				source: "mouse",
				value: "alpha",
			});
			await primary.click();
			await primary.press("Control+A");
			await primary.press("Backspace");
			const lockedOption = page.getByRole("option", { name: /Locked/ });
			expect(await lockedOption.getAttribute("aria-disabled")).toBe("true");
			const changesBeforeLockedPress = (await fixture()).valueChanges.length;
			await lockedOption.click({ force: true });
			expect((await fixture()).valueChanges.length).toBe(
				changesBeforeLockedPress,
			);
			await primary.press("Escape");
			expect((await fixture()).openChanges.some((change) => change.open)).toBe(
				true,
			);

			const multiple = page.getByRole("combobox", { name: "Multiple choices" });
			const multipleRoot = multiple.locator("..");
			expect(
				await multipleRoot
					.getByRole("button", { name: "Remove Alpha" })
					.count(),
			).toBe(1);
			await multipleRoot.getByRole("button", { name: "Remove Alpha" }).click();
			expect((await fixture()).multipleChanges.at(-1)).toEqual({
				source: "mouse",
				value: [],
			});
			await multiple.pressSequentially("be");
			await multiple.press("ArrowDown");
			await multiple.press("Enter");
			expect((await fixture()).multipleChanges.at(-1)).toEqual({
				source: "keyboard",
				value: ["beta"],
			});
			expect(
				await multipleRoot.getByRole("button", { name: "Remove Beta" }).count(),
			).toBe(1);
			await multiple.press("Escape");

			const controlled = page.getByRole("combobox", {
				name: "Controlled choice",
			});
			expect(await controlled.inputValue()).toBe("Alpha");
			await controlled.click();
			await controlled.press("Control+A");
			await controlled.pressSequentially("be");
			await controlled.press("ArrowDown");
			await controlled.press("Enter");
			expect((await fixture()).controlledChanges.at(-1)).toEqual({
				source: "keyboard",
				value: "beta",
			});
			expect(await controlled.inputValue()).toBe("Beta");
			await controlled.press("Control+A");
			await controlled.press("Backspace");
			const controlledListId = await controlled.getAttribute("aria-controls");
			if (!controlledListId) throw new Error("Controlled list was not exposed");
			const controlledList = page.locator(`[id="${controlledListId}"]`);
			expect(
				await controlledList
					.getByRole("option", { name: /Alpha/ })
					.getAttribute("aria-selected"),
			).toBe("true");
			expect(
				await controlledList
					.getByRole("option", { name: /Beta/ })
					.getAttribute("aria-selected"),
			).toBe("false");
			await controlled.press("Escape");

			const controlledQuery = page.getByRole("combobox", {
				name: "Controlled query",
			});
			expect(await controlledQuery.inputValue()).toBe("fixed");
			await controlledQuery.focus();
			await controlledQuery.pressSequentially("x");
			expect((await fixture()).controlledQueryChanges.at(-1)).toEqual({
				query: "fixedx",
				source: "keyboard",
			});
			expect((await fixture()).controlledOpenChanges.at(-1)).toEqual({
				open: true,
				source: "keyboard",
			});
			expect(await controlledQuery.inputValue()).toBe("fixed");
			expect(await controlledQuery.getAttribute("aria-expanded")).toBe("false");

			const disabled = page.getByRole("combobox", { name: "Disabled choice" });
			expect(await disabled.isDisabled()).toBe(true);
			await disabled.focus();
			expect(
				await disabled.evaluate(
					(element) => document.activeElement === element,
				),
			).toBe(false);

			const inline = page.getByRole("combobox", { name: "Inline choice" });
			expect(
				await primary.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(32);
			expect(
				await inline.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(26);
			await primary.focus();
			expect(
				await primary.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).not.toBe("none");

			const narrow = page.getByRole("combobox", { name: "Narrow choice" });
			await narrow.click();
			const narrowContent = page.locator(
				'[data-slot="combobox-content"][data-open]:visible',
			);
			const narrowGeometry = await narrowContent.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				const anchor = document
					.querySelector('[aria-label="Narrow choice"]')
					?.getBoundingClientRect();
				return {
					anchorWidth: anchor?.width ?? 0,
					contentRight: bounds.right,
					contentWidth: bounds.width,
					viewportWidth: window.innerWidth,
				};
			});
			expect(narrowGeometry.contentWidth).toBeGreaterThanOrEqual(
				narrowGeometry.anchorWidth,
			);
			expect(narrowGeometry.contentRight).toBeLessThanOrEqual(
				narrowGeometry.viewportWidth,
			);
			const longOption = page.getByRole("option", {
				name: /deliberately long option/,
			});
			const longText = longOption.locator('[data-slot="combobox-item-text"]');
			expect(
				await longOption.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			expect(
				await longText.evaluate(
					(element) => getComputedStyle(element).textOverflow,
				),
			).toBe("ellipsis");
			await narrow.press("Escape");
			expect(
				await narrow.evaluate((element) => document.activeElement === element),
			).toBe(true);
			await narrow.click();
			await narrow.press("ArrowDown");
			await narrow.press("ArrowDown");
			expect(
				await page
					.locator('[data-slot="combobox-item"][data-highlighted]')
					.textContent(),
			).toContain("Beta");
			await narrow.press("Enter");
			expect(await narrow.inputValue()).toBe("Beta");
			await narrow.press("Control+A");
			await narrow.press("Backspace");
			await narrow.press("Escape");

			const readOnly = page.getByRole("combobox", { name: "Read-only choice" });
			expect(await readOnly.getAttribute("readonly")).not.toBeNull();
			await readOnly.focus();
			expect(
				await readOnly.evaluate(
					(element) => document.activeElement === element,
				),
			).toBe(true);
			const valuesBeforeReadOnly = (await fixture()).valueChanges.length;
			const queriesBeforeReadOnly = (await fixture()).queryChanges.length;
			await readOnly.click();
			expect(await readOnly.getAttribute("aria-expanded")).toBe("false");
			await readOnly.press("ArrowDown");
			expect(await readOnly.getAttribute("aria-expanded")).toBe("false");
			await readOnly.pressSequentially("alpha");
			expect(await readOnly.inputValue()).toBe("Beta");
			expect((await fixture()).valueChanges.length).toBe(valuesBeforeReadOnly);
			expect((await fixture()).queryChanges.length).toBe(queriesBeforeReadOnly);

			const formValues = await page.evaluate(() => {
				const primaryForm =
					document.querySelector<HTMLFormElement>("#combobox-form");
				const externalForm =
					document.querySelector<HTMLFormElement>("#external-form");
				if (!(primaryForm && externalForm))
					throw new Error("Combobox forms missing");
				return {
					external: [...new FormData(externalForm).entries()],
					primary: [...new FormData(primaryForm).entries()],
					valid: primaryForm.checkValidity(),
				};
			});
			expect(formValues.primary).toEqual([
				["read-only-choice", "beta"],
				["form-choice", "beta"],
			]);
			expect(formValues.external).toEqual([
				["external-choice", "alpha"],
				["external-choice", "beta"],
			]);
			expect(formValues.valid).toBe(true);

			const external = page.getByRole("combobox", { name: "External choices" });
			const externalRoot = external.locator("..");
			await externalRoot.getByRole("button", { name: "Remove Alpha" }).click();
			expect((await fixture()).externalChanges.at(-1)).toEqual({
				source: "mouse",
				value: ["beta"],
			});
			await page
				.locator("#external-form")
				.evaluate((form: HTMLFormElement) => form.reset());
			await page.waitForTimeout(50);
			expect((await fixture()).externalChanges.at(-1)).toEqual({
				source: "programmatic",
				value: ["alpha", "beta"],
			});
			expect(
				await externalRoot
					.getByRole("button", { name: "Remove Alpha" })
					.count(),
			).toBe(1);

			const formChoice = page.getByRole("combobox", { name: "Form choice" });
			await formChoice.click();
			await formChoice.press("Control+A");
			await formChoice.press("Backspace");
			expect(
				await page
					.locator("#combobox-form")
					.evaluate((form: HTMLFormElement) => form.checkValidity()),
			).toBe(false);
			await page.getByRole("button", { name: "Reset combobox form" }).click();
			await page.waitForTimeout(50);
			expect(await formChoice.inputValue()).toBe("Beta");
			expect((await fixture()).valueChanges.at(-1)).toEqual({
				source: "programmatic",
				value: "beta",
			});
			expect(
				await page
					.locator("#combobox-form")
					.evaluate((form: HTMLFormElement) => form.checkValidity()),
			).toBe(true);

			const betaChip = multipleRoot
				.getByRole("button", { name: "Remove Beta" })
				.locator("..");
			expect(await betaChip.getAttribute("data-tone")).toBe("warning");

			await page.emulateMedia({ reducedMotion: "no-preference" });
			await narrow.click();
			const animatedContent = page.locator(
				'[data-slot="combobox-content"][data-open]:visible',
			);
			expect(
				await animatedContent.evaluate((element) =>
					getComputedStyle(element)
						.transitionDuration.split(",")
						.some((duration) => Number.parseFloat(duration) > 0),
				),
			).toBe(true);
			await page.mouse.click(1_100, 700);
			expect(await narrow.getAttribute("aria-expanded")).toBe("false");

			await page.emulateMedia({ reducedMotion: "reduce" });
			await narrow.click();
			expect(
				await page
					.locator('[data-slot="combobox-content"][data-open]:visible')
					.evaluate((element) =>
						getComputedStyle(element)
							.transitionDuration.split(",")
							.every((duration) => Number.parseFloat(duration) === 0),
					),
			).toBe(true);
			await narrow.press("Escape");

			await page.emulateMedia({ reducedMotion: "no-preference" });
			const app = page.locator("main");
			await app.evaluate(() => {
				document.documentElement.classList.add("tripwire");
				document.documentElement.setAttribute("data-theme", "light");
				document.querySelector("main")?.setAttribute("data-theme", "light");
			});
			const lightInputColors = await narrow.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.borderColor, style.color];
			});
			await narrow.click();
			const lightPopupColors = await page
				.locator('[data-slot="combobox-content"][data-open]:visible')
				.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.borderColor];
				});
			await narrow.press("Escape");
			await app.evaluate(() => {
				document.documentElement.setAttribute("data-theme", "dark");
				document.querySelector("main")?.setAttribute("data-theme", "dark");
			});
			await page.waitForTimeout(50);
			const darkInputColors = await narrow.evaluate((element) => {
				const style = getComputedStyle(element);
				return [style.backgroundColor, style.borderColor, style.color];
			});
			await narrow.click();
			const darkPopupColors = await page
				.locator('[data-slot="combobox-content"][data-open]:visible')
				.evaluate((element) => {
					const style = getComputedStyle(element);
					return [style.backgroundColor, style.borderColor];
				});
			expect(darkInputColors).not.toEqual(lightInputColors);
			expect(darkPopupColors).not.toEqual(lightPopupColors);
			await narrow.press("Escape");

			await page.emulateMedia({ forcedColors: "active" });
			await narrow.click();
			expect(
				await narrow.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await page
					.locator('[data-slot="combobox-content"][data-open]:visible')
					.evaluate((element) => getComputedStyle(element).forcedColorAdjust),
			).toBe("none");
			await narrow.press("Escape");
			await page.emulateMedia({ forcedColors: "none" });

			await narrow.fill("no matching value");
			expect(await page.getByText("No results", { exact: true }).count()).toBe(
				1,
			);
			await narrow.press("Control+A");
			await narrow.press("Backspace");
			await narrow.press("Escape");

			const create = page.getByRole("combobox", { name: "Create choice" });
			await create.pressSequentially("zeta");
			const createOption = page.getByRole("option", { name: "Create zeta" });
			expect(await createOption.getAttribute("aria-selected")).toBe("false");
			expect(await createOption.getAttribute("data-slot")).toBe(
				"combobox-create",
			);
			await createOption.click();
			expect((await fixture()).created).toEqual([
				{ query: "zeta", source: "mouse" },
			]);
			await create.press("Control+A");
			await create.press("Backspace");
			await create.pressSequentially("omega");
			await create.press("ArrowDown");
			await create.press("Enter");
			expect((await fixture()).created.at(-1)).toEqual({
				query: "omega",
				source: "keyboard",
			});

			const objectInput = page.getByRole("combobox", {
				name: "Object choices",
			});
			const oneChip = page
				.getByRole("button", { name: "Remove One" })
				.locator("..");
			expect(
				await page.getByRole("button", { name: "Remove Two" }).count(),
			).toBe(1);
			await page.evaluate(() => {
				const chip = document
					.querySelector('[aria-label="Remove One"]')
					?.closest('[data-slot="combobox-chip"]');
				(window as Window & { firstObjectChip?: Element }).firstObjectChip =
					chip ?? undefined;
			});
			await page.getByRole("button", { name: "Reverse object values" }).click();
			expect(
				await oneChip.evaluate(
					(element) =>
						element ===
						(window as Window & { firstObjectChip?: Element }).firstObjectChip,
				),
			).toBe(true);
			await page.getByRole("button", { name: "Remove One" }).click();
			expect(
				await page.evaluate(() =>
					(window as unknown as ComboboxFixtureWindow).objectChanges.at(-1),
				),
			).toEqual({ source: "mouse", value: ["two"] });
			expect(await objectInput.inputValue()).toBe("");

			const createAgentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as ComboboxFixtureWindow;
				const createCombobox = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Create choice");
				if (!createCombobox) throw new Error("Create combobox was not exposed");
				const queried = await fixtureWindow.agent.act({
					steps: [
						{ action: "setQuery", args: ["sigma"], ref: createCombobox.ref },
						{ action: "setOpen", args: [true], ref: createCombobox.ref },
					],
				});
				const components = fixtureWindow.agent.snapshot();
				const createAction = components.find(
					(component) => component.label === "Create sigma",
				);
				if (!createAction) throw new Error(JSON.stringify(components));
				const created = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: createAction.ref }],
				});
				return [queried, created];
			});
			expect(createAgentResults.map((result) => result.ok)).toEqual([
				true,
				true,
			]);
			expect((await fixture()).created.at(-1)).toEqual({
				query: "sigma",
				source: "agent",
			});

			const agentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as ComboboxFixtureWindow;
				const components = fixtureWindow.agent.snapshot();
				const primary = components.find(
					(component) => component.label === "Primary choice",
				);
				const disabled = components.find(
					(component) => component.label === "Disabled choice",
				);
				const object = components.find(
					(component) => component.label === "Object choices",
				);
				const readOnly = components.find(
					(component) => component.label === "Read-only choice",
				);
				if (!primary || !disabled || !object || !readOnly)
					throw new Error(JSON.stringify(components));
				const selected = await fixtureWindow.agent.act({
					steps: [{ action: "setValue", args: ["beta"], ref: primary.ref }],
				});
				const queried = await fixtureWindow.agent.act({
					steps: [{ action: "setQuery", args: ["agent"], ref: primary.ref }],
				});
				const closed = await fixtureWindow.agent.act({
					steps: [{ action: "setOpen", args: [false], ref: primary.ref }],
				});
				const opened = await fixtureWindow.agent.act({
					steps: [{ action: "setOpen", args: [true], ref: primary.ref }],
				});
				const closedAgain = await fixtureWindow.agent.act({
					steps: [{ action: "setOpen", args: [false], ref: primary.ref }],
				});
				const disabledSelection = await fixtureWindow.agent.act({
					steps: [{ action: "setValue", args: ["alpha"], ref: disabled.ref }],
				});
				const disabledQuery = await fixtureWindow.agent.act({
					steps: [{ action: "setQuery", args: ["alpha"], ref: disabled.ref }],
				});
				const disabledOpen = await fixtureWindow.agent.act({
					steps: [{ action: "setOpen", args: [true], ref: disabled.ref }],
				});
				const disabledOption = await fixtureWindow.agent.act({
					steps: [{ action: "setValue", args: ["locked"], ref: primary.ref }],
				});
				const readOnlySelection = await fixtureWindow.agent.act({
					steps: [{ action: "setValue", args: ["alpha"], ref: readOnly.ref }],
				});
				const readOnlyQuery = await fixtureWindow.agent.act({
					steps: [{ action: "setQuery", args: ["alpha"], ref: readOnly.ref }],
				});
				const readOnlyOpen = await fixtureWindow.agent.act({
					steps: [{ action: "setOpen", args: [true], ref: readOnly.ref }],
				});
				const selectedObject = await fixtureWindow.agent.act({
					steps: [{ action: "setValue", args: [["one"]], ref: object.ref }],
				});
				return [
					selected,
					queried,
					closed,
					opened,
					closedAgain,
					disabledSelection,
					disabledQuery,
					disabledOpen,
					disabledOption,
					readOnlySelection,
					readOnlyQuery,
					readOnlyOpen,
					selectedObject,
				];
			});
			expect(agentResults.map((result) => result.ok)).toEqual([
				true,
				true,
				true,
				true,
				true,
				false,
				false,
				false,
				false,
				false,
				false,
				false,
				true,
			]);
			expect((await fixture()).openChanges.slice(-3)).toEqual([
				{ open: false, source: "agent" },
				{ open: true, source: "agent" },
				{ open: false, source: "agent" },
			]);
			expect((await fixture()).valueChanges.at(-1)).toEqual({
				source: "agent",
				value: "beta",
			});
			expect(
				(await fixture()).queryChanges.some(
					(change) => change.query === "agent" && change.source === "agent",
				),
			).toBe(true);
			expect((await fixture()).objectChanges.at(-1)).toEqual({
				source: "agent",
				value: ["one"],
			});
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
