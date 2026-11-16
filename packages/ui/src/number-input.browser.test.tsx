import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface NumberInputFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	controlledChanges: Array<{ source: string; value: number | null }>;
	disabledChanges: Array<{ source: string; value: number | null }>;
	formEntries: Array<[string, FormDataEntryValue]>;
	quantityChanges: Array<{ source: string; value: number | null }>;
	readOnlyChanges: Array<{ source: string; value: number | null }>;
}

test("number inputs own bounds, controlled state, forms, keyboard, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-number-input-"));
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
			import { NumberInput } from ${JSON.stringify(fileURLToPath(new URL("./number-input.tsx", import.meta.url)))};

			window.controlledChanges = [];
			window.disabledChanges = [];
			window.formEntries = [];
			window.quantityChanges = [];
			window.readOnlyChanges = [];
			window.agent = createAgent({ allow: () => true });
			createRoot(document.getElementById("root")).render(createElement(
				"form",
				{
					onSubmit: (event) => {
						event.preventDefault();
						window.formEntries = [...new FormData(event.currentTarget).entries()];
					},
				},
				createElement(NumberInput, {
					ariaDescribedBy: "quantity-description",
					ariaLabel: "Quantity",
					defaultValue: 2,
					invalid: true,
					max: 4,
					min: 0,
					name: "quantity",
					onValueChange: (value, details) => window.quantityChanges.push({ source: details.source, value }),
					step: 2,
					unit: "seats",
				}),
				createElement("span", { id: "quantity-description" }, "Between zero and four seats."),
				createElement("span", { id: "controlled-label" }, "Controlled limit"),
				createElement(NumberInput, {
					ariaLabelledBy: "controlled-label",
					onValueChange: (value, details) => window.controlledChanges.push({ source: details.source, value }),
					value: 3,
				}),
				createElement(NumberInput, {
					ariaLabel: "Read-only limit",
					defaultValue: 5,
					name: "readonly-limit",
					onValueChange: (value, details) => window.readOnlyChanges.push({ source: details.source, value }),
					readOnly: true,
				}),
				createElement(NumberInput, {
					ariaLabel: "Disabled limit",
					defaultValue: 9,
					disabled: true,
					name: "disabled-limit",
					onValueChange: (value, details) => window.disabledChanges.push({ source: details.source, value }),
				}),
				createElement(NumberInput, {
					ariaLabel: "Required limit",
					name: "required-limit",
					required: true,
				}),
				createElement("button", { type: "submit" }, "Submit"),
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
			throw new Error("NumberInput browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://number-input.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://number-input.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://number-input.test/") {
					await route.fulfill({
						body: '<link rel="stylesheet" href="/client.css"><div class="tripwire" data-system="tripwire" id="root"></div><script type="module" src="/client.js"></script>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://number-input.test/");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as NumberInputFixtureWindow;
					return {
						controlledChanges: value.controlledChanges,
						disabledChanges: value.disabledChanges,
						formEntries: value.formEntries,
						quantityChanges: value.quantityChanges,
						readOnlyChanges: value.readOnlyChanges,
					};
				});

			const quantity = page.getByRole("spinbutton", { name: "Quantity" });
			const increment = page.getByRole("button", { name: "Increase Quantity" });
			const decrement = page.getByRole("button", { name: "Decrease Quantity" });
			const quantityId = await quantity.getAttribute("id");
			expect(quantityId).not.toBeNull();
			expect(await increment.getAttribute("aria-controls")).toBe(quantityId);
			expect(await decrement.getAttribute("aria-controls")).toBe(quantityId);
			expect(await quantity.inputValue()).toBe("2");
			expect(await quantity.getAttribute("aria-describedby")).toBe(
				"quantity-description",
			);
			expect(await quantity.getAttribute("aria-invalid")).toBe("true");
			expect(await quantity.getAttribute("aria-valuemin")).toBe("0");
			expect(await quantity.getAttribute("aria-valuemax")).toBe("4");
			expect(await quantity.getAttribute("aria-valuenow")).toBe("2");
			expect(await page.getByText("seats", { exact: true }).count()).toBe(1);
			const group = page.locator('[data-slot="number-input-group"]').first();
			const geometry = await group.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				const decrement = element
					.querySelector('[data-slot="number-input-decrement"]')
					?.getBoundingClientRect();
				const increment = element
					.querySelector('[data-slot="number-input-increment"]')
					?.getBoundingClientRect();
				return {
					decrementInset: decrement ? decrement.left - bounds.left : null,
					height: bounds.height,
					incrementInset: increment ? bounds.right - increment.right : null,
					stepHeight: increment?.height ?? null,
					stepWidth: increment?.width ?? null,
				};
			});
			expect(geometry.height).toBe(32);
			expect(geometry.stepHeight).toBe(24);
			expect(geometry.stepWidth).toBe(24);
			expect(geometry.decrementInset).toBe(4);
			expect(geometry.incrementInset).toBe(4);
			const restingStepBackground = await increment.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			expect(
				await increment.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0.12s");
			await increment.hover();
			await page.waitForTimeout(200);
			expect(
				await increment.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).not.toBe(restingStepBackground);
			await increment.click();
			expect(await quantity.inputValue()).toBe("4");
			expect((await fixture()).quantityChanges.at(-1)).toEqual({
				source: "mouse",
				value: 4,
			});
			expect(await increment.isDisabled()).toBe(true);
			await quantity.press("ArrowDown");
			expect(await quantity.inputValue()).toBe("2");
			expect((await fixture()).quantityChanges.at(-1)).toEqual({
				source: "keyboard",
				value: 2,
			});
			await quantity.press("Home");
			expect(await quantity.inputValue()).toBe("0");
			expect(await decrement.isDisabled()).toBe(true);
			await quantity.press("End");
			expect(await quantity.inputValue()).toBe("4");
			await quantity.fill("99");
			await quantity.press("Enter");
			expect(await quantity.inputValue()).toBe("4");

			const controlled = page.getByRole("spinbutton", {
				name: "Controlled limit",
			});
			expect(await page.locator(".ui-sr-only").count()).toBe(2);
			expect(
				await page
					.locator(".ui-sr-only")
					.first()
					.evaluate((element) => {
						const style = getComputedStyle(element);
						const bounds = element.getBoundingClientRect();
						return {
							clip: style.clip,
							height: bounds.height,
							overflow: style.overflow,
							width: bounds.width,
						};
					}),
			).toEqual({
				clip: "rect(0px, 0px, 0px, 0px)",
				height: 1,
				overflow: "hidden",
				width: 1,
			});
			const controlledId = await controlled.getAttribute("id");
			expect(controlledId).not.toBeNull();
			expect(
				await page
					.getByRole("button", { name: "Increase Controlled limit" })
					.getAttribute("aria-controls"),
			).toBe(controlledId);
			expect(
				await page
					.getByRole("button", { name: "Decrease Controlled limit" })
					.getAttribute("aria-controls"),
			).toBe(controlledId);
			const controlledGroup = page
				.locator('[data-slot="number-input-group"]')
				.nth(1);
			const restingBorder = await controlledGroup.evaluate(
				(element) => getComputedStyle(element).borderColor,
			);
			await controlled.focus();
			expect(
				await controlled.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).toBe("none");
			expect(
				await controlledGroup.evaluate(
					(element) => getComputedStyle(element).borderColor,
				),
			).not.toBe(restingBorder);
			await controlled.press("ArrowUp");
			expect(await controlled.inputValue()).toBe("3");
			expect((await fixture()).controlledChanges.at(-1)).toEqual({
				source: "keyboard",
				value: 4,
			});

			const readOnly = page.getByRole("spinbutton", {
				name: "Read-only limit",
			});
			await readOnly.focus();
			expect(
				await readOnly.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await readOnly.press("ArrowUp");
			expect(await readOnly.inputValue()).toBe("5");
			expect((await fixture()).readOnlyChanges).toEqual([]);

			const disabled = page.getByRole("spinbutton", {
				name: "Disabled limit",
			});
			expect(await disabled.isDisabled()).toBe(true);
			const required = page.getByRole("spinbutton", {
				name: "Required limit",
			});
			expect(
				await page
					.locator("form")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(false);

			const agentResults = await page.evaluate(async () => {
				const value = window as unknown as NumberInputFixtureWindow;
				const components = value.agent.snapshot();
				const byLabel = (label: string) =>
					components.find((component) => component.label === label);
				const quantity = byLabel("Quantity");
				const controlled = byLabel("Controlled limit");
				const readOnly = byLabel("Read-only limit");
				const disabled = byLabel("Disabled limit");
				const required = byLabel("Required limit");
				if (!quantity || !controlled || !readOnly || !disabled || !required) {
					throw new Error("Number inputs were not exposed to the agent");
				}
				return {
					controlled: await value.agent.act({
						steps: [{ action: "setValue", args: [8], ref: controlled.ref }],
					}),
					disabled: await value.agent.act({
						steps: [{ action: "setValue", args: [1], ref: disabled.ref }],
					}),
					quantity: await value.agent.act({
						steps: [{ action: "setValue", args: [2], ref: quantity.ref }],
					}),
					readOnly: await value.agent.act({
						steps: [{ action: "setValue", args: [1], ref: readOnly.ref }],
					}),
					required: await value.agent.act({
						steps: [{ action: "setValue", args: [6], ref: required.ref }],
					}),
				};
			});
			expect(
				Object.fromEntries(
					Object.entries(agentResults).map(([key, result]) => [key, result.ok]),
				),
			).toEqual({
				controlled: true,
				disabled: false,
				quantity: true,
				readOnly: false,
				required: true,
			});
			expect((await fixture()).quantityChanges.at(-1)).toEqual({
				source: "agent",
				value: 2,
			});
			expect((await fixture()).controlledChanges.at(-1)).toEqual({
				source: "agent",
				value: 8,
			});
			expect((await fixture()).readOnlyChanges).toEqual([]);
			expect((await fixture()).disabledChanges).toEqual([]);
			expect(await controlled.inputValue()).toBe("3");
			expect(await required.inputValue()).toBe("6");
			expect(
				await page
					.locator("form")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(true);

			await page.getByRole("button", { name: "Submit" }).click();
			expect((await fixture()).formEntries).toEqual([
				["quantity", "2"],
				["readonly-limit", "5"],
				["required-limit", "6"],
			]);

			const root = page.locator("#root");
			const lightSurface = await group.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			await root.evaluate((element) =>
				element.setAttribute("data-theme", "dark"),
			);
			expect(
				await group.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).not.toBe(lightSurface);
			await page.emulateMedia({ reducedMotion: "reduce" });
			expect(
				await increment.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0s");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
