import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface FieldFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{
			actions: string[];
			component: string;
			disabled?: boolean;
			label?: string;
			readOnly?: boolean;
			ref: string;
		}>;
	};
	controlledValues: Array<{ source: string; value: string }>;
	formEntries: Array<[string, FormDataEntryValue]>;
	inputValues: Array<{ source: string; value: string }>;
	readOnlyChanges: string[];
	textareaValues: Array<{ source: string; value: string }>;
}

test("fields own naming, validation, form, controlled, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-fields-"));
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
			import { Field, FieldDescription, FieldError, FieldLabel, FieldSet, Input, Textarea } from ${JSON.stringify(fileURLToPath(new URL("./field.tsx", import.meta.url)))};

			window.controlledValues = [];
			window.formEntries = [];
			window.inputValues = [];
			window.readOnlyChanges = [];
			window.textareaValues = [];
			window.agent = createAgent({ allow: () => true });
			function DynamicFieldSet() {
				const [disabled, setDisabled] = useState(true);
				return createElement(Fragment, null,
					createElement("button", { onClick: () => setDisabled(false), type: "button" }, "Enable details"),
					createElement(FieldSet, { disabled, legend: "Disabled details" },
						createElement(Field, { name: "disabled-value" },
							createElement(FieldLabel, null, "Disabled value"),
							createElement(Input, {
								defaultValue: "ignored",
								labelledByField: true,
								name: "disabled-value",
							}),
						),
					),
				);
			}
			createRoot(document.getElementById("root")).render(createElement(
				"form",
				{
					onSubmit: (event) => {
						event.preventDefault();
						window.formEntries = [...new FormData(event.currentTarget).entries()];
					},
				},
				createElement(Field, { invalid: true },
					createElement(FieldLabel, null, "Email"),
					createElement(Input, {
						defaultValue: "bad",
						labelledByField: true,
						name: "email",
						onValueChange: (value, details) => window.inputValues.push({ source: details.source, value }),
						required: true,
						type: "email",
					}),
					createElement(FieldDescription, null, "Used for account notices."),
					createElement(FieldError, null, "Enter a valid email."),
				),
				createElement(Field, null,
					createElement(FieldLabel, null, "Notes"),
					createElement(Textarea, {
						labelledByField: true,
						maxLength: 40,
						name: "notes",
						onValueChange: (value, details) => window.textareaValues.push({ source: details.source, value }),
						rows: 3,
					}),
				),
				createElement(Field, null,
					createElement(FieldLabel, null, "Recovery email"),
					createElement(Input, {
						defaultValue: "",
						labelledByField: true,
						name: "recovery-email",
						required: true,
						type: "email",
					}),
					createElement(FieldError, { match: "valueMissing" }, "Recovery email is required."),
					createElement(FieldError, { match: "typeMismatch" }, "Use an email address."),
				),
				createElement(Field, { invalid: true },
					createElement(FieldLabel, null, "Server value"),
					createElement(Input, { labelledByField: true }),
					createElement(FieldError, { match: true }, "The server rejected this value."),
				),
				createElement(Input, {
					ariaLabel: "Controlled value",
					onValueChange: (value, details) => window.controlledValues.push({ source: details.source, value }),
					value: "fixed",
				}),
				createElement("span", { id: "reference-label" }, "Referenced value"),
				createElement(Input, {
					ariaLabelledBy: "reference-label",
					defaultValue: "linked",
				}),
				createElement(Field, null,
					createElement(FieldLabel, null, "Repository installation identifier with a deliberately long label"),
					createElement(Input, {
						copy: { label: "Copy adorned value", value: "framed" },
						defaultValue: "framed",
						labelledByField: true,
						leadingIcon: createElement("span", null, "#"),
					}),
				),
				createElement(Input, {
					ariaLabel: "Read-only token",
					defaultValue: "locked",
					name: "token",
					onValueChange: () => window.readOnlyChanges.push("input"),
					readOnly: true,
				}),
				createElement(Textarea, {
					ariaLabel: "Read-only note",
					defaultValue: "kept",
					name: "readonly-note",
					onValueChange: () => window.readOnlyChanges.push("textarea"),
					readOnly: true,
				}),
				createElement(Input, {
					appearance: "compact-search",
					ariaKeyShortcuts: "/",
					ariaLabel: "Find a workflow",
					showShortcutHint: true,
					type: "search",
				}),
				createElement(DynamicFieldSet),
				createElement("button", { type: "reset" }, "Reset"),
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
			throw new Error("Field browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://fields.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://fields.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://fields.test/") {
					await route.fulfill({
						body: '<link rel="stylesheet" href="/client.css"><body class="tripwire"><div id="root"></div><script type="module" src="/client.js"></script></body>',
						contentType: "text/html",
					});
					return;
				}
				await route.abort();
			});
			const page = await context.newPage();
			page.setDefaultTimeout(2_000);
			await page.goto("http://fields.test/");
			const search = page.getByRole("searchbox", { name: "Find a workflow" });
			const shortcutHint = page.locator('[data-slot="input-shortcut-hint"]');
			await search.waitFor();
			expect(await search.getAttribute("aria-keyshortcuts")).toBe("/");
			expect(await shortcutHint.getAttribute("aria-hidden")).toBe("true");
			const keycap = shortcutHint.locator("kbd");
			expect(await keycap.textContent()).toBe("/");
			expect(
				await keycap.evaluate((element) => {
					const { height, width } = element.getBoundingClientRect();
					return { height, width };
				}),
			).toEqual({ height: 16, width: 16 });

			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as FieldFixtureWindow;
					return {
						controlledValues: value.controlledValues,
						formEntries: value.formEntries,
						inputValues: value.inputValues,
						readOnlyChanges: value.readOnlyChanges,
						textareaValues: value.textareaValues,
					};
				});

			const email = page.getByRole("textbox", { exact: true, name: "Email" });
			const notes = page.getByRole("textbox", { name: "Notes" });
			const visualEvidence = async () =>
				email.evaluate((element) => {
					const input = getComputedStyle(element);
					const label = getComputedStyle(
						document.querySelector('[data-slot="field-label"]') as Element,
					);
					const textarea = getComputedStyle(
						document.querySelector('[data-slot="textarea"]') as Element,
					);
					return {
						background: input.backgroundColor,
						border: input.borderTopColor,
						color: input.color,
						height: input.height,
						labelColor: label.color,
						labelSize: label.fontSize,
						padding: input.paddingInlineStart,
						radius: input.borderRadius,
						textareaMinHeight: textarea.minHeight,
						textareaRadius: textarea.borderRadius,
						transition: input.transitionDuration,
						theme: document.body.getAttribute("data-theme"),
						themeField: getComputedStyle(document.body)
							.getPropertyValue("--field")
							.trim(),
						themeSurface: getComputedStyle(document.body)
							.getPropertyValue("--tw-surface-inset")
							.trim(),
					};
				});
			const lightVisual = await visualEvidence();
			expect(lightVisual.height).toBe("32px");
			expect(lightVisual.padding).toBe("12px");
			expect(lightVisual.labelSize).toBe("13px");
			expect(lightVisual.textareaMinHeight).toBe("64px");
			expect(lightVisual.textareaRadius).toBe("10px");
			expect(lightVisual.radius).toBe("999px");
			expect(lightVisual.transition).toContain("0.16s");
			await page
				.locator("body")
				.evaluate((element) => element.setAttribute("data-theme", "dark"));
			await page.waitForTimeout(200);
			const darkVisual = await visualEvidence();
			expect(darkVisual.theme).toBe("dark");
			expect(darkVisual.textareaRadius).toBe("10px");
			expect(darkVisual.radius).toBe("999px");
			expect(darkVisual.themeField).not.toBe(lightVisual.themeField);
			expect(darkVisual.themeSurface).not.toBe(lightVisual.themeSurface);
			expect(darkVisual.background).not.toBe(lightVisual.background);
			expect(darkVisual.border).not.toBe(lightVisual.border);
			expect(darkVisual.color).not.toBe(lightVisual.color);
			expect(darkVisual.labelColor).not.toBe(lightVisual.labelColor);
			await page
				.locator("body")
				.evaluate((element) => element.setAttribute("data-theme", "light"));
			await page.waitForTimeout(200);
			for (const theme of ["light", "dark"] as const) {
				await page.locator("body").evaluate((element, nextTheme) => {
					element.setAttribute("data-theme", nextTheme);
				}, theme);
				await page.waitForTimeout(200);
				for (const width of [390, 768, 1280, 1920]) {
					await page.setViewportSize({ height: 900, width });
					expect(
						await page.evaluate(
							() => document.documentElement.scrollWidth <= window.innerWidth,
						),
					).toBe(true);
					const bounds = await page
						.getByRole("textbox", {
							name: "Repository installation identifier with a deliberately long label",
						})
						.boundingBox();
					expect(bounds).not.toBeNull();
					expect((bounds?.x ?? -1) >= 0).toBe(true);
					expect((bounds?.x ?? 0) + (bounds?.width ?? width + 1) <= width).toBe(
						true,
					);
					expect((await page.screenshot()).byteLength).toBeGreaterThan(1_000);
				}
			}
			await page.setViewportSize({ height: 900, width: 1280 });
			await page
				.locator("body")
				.evaluate((element) => element.setAttribute("data-theme", "light"));
			await page.waitForTimeout(200);
			await email.focus();
			expect(
				await email.evaluate(
					(element) => getComputedStyle(element).outlineWidth,
				),
			).toBe("2px");
			await page.emulateMedia({ reducedMotion: "reduce" });
			expect((await visualEvidence()).transition).toBe("0s");
			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "no-preference",
			});
			const forcedColorVisual = await email.evaluate((element) => {
				const style = getComputedStyle(element);
				return {
					borderColor: style.borderTopColor,
					borderWidth: style.borderTopWidth,
					forcedColorAdjust: style.forcedColorAdjust,
				};
			});
			expect(forcedColorVisual).toMatchObject({
				borderWidth: "1px",
				forcedColorAdjust: "auto",
			});
			expect(forcedColorVisual.borderColor).not.toBe("rgba(0, 0, 0, 0)");
			await page.emulateMedia({ forcedColors: "none" });
			const describedBy = await email.getAttribute("aria-describedby");
			expect(describedBy).not.toBeNull();
			expect(
				await page.evaluate(
					(ids) =>
						ids
							?.split(" ")
							.map((id) => document.getElementById(id)?.textContent)
							.join(" "),
					describedBy,
				),
			).toContain("Used for account notices.");
			expect(
				await page.evaluate(
					(ids) =>
						ids
							?.split(" ")
							.map((id) => document.getElementById(id)?.textContent)
							.join(" "),
					describedBy,
				),
			).toContain("Enter a valid email.");
			expect(await email.getAttribute("aria-invalid")).toBe("true");
			const recovery = page.getByRole("textbox", { name: "Recovery email" });
			const recoveryRequired = page
				.locator('[data-slot="field-error"]')
				.filter({ hasText: "Recovery email is required." });
			const recoveryType = page
				.locator('[data-slot="field-error"]')
				.filter({ hasText: "Use an email address." });
			const recoveryDescription = async () =>
				page.evaluate(
					(ids) =>
						ids
							?.split(" ")
							.map((id) => document.getElementById(id)?.textContent)
							.filter(Boolean)
							.join(" ") ?? "",
					await recovery.getAttribute("aria-describedby"),
				);
			expect(await recoveryRequired.isVisible()).toBe(false);
			expect(await recoveryType.isVisible()).toBe(false);
			expect(
				await page
					.locator('[data-slot="field-error"]')
					.filter({ hasText: "The server rejected this value." })
					.isVisible(),
			).toBe(true);
			expect(
				await page
					.locator("form")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(false);
			await page.getByRole("button", { name: "Submit" }).click();
			expect(await recoveryRequired.isVisible()).toBe(true);
			expect(await recoveryType.isVisible()).toBe(false);
			expect(await recoveryDescription()).toContain(
				"Recovery email is required.",
			);
			expect(await recoveryDescription()).not.toContain(
				"Use an email address.",
			);
			await recovery.fill("not-an-email");
			await page.getByRole("button", { name: "Submit" }).click();
			expect(await recoveryRequired.isVisible()).toBe(false);
			expect(await recoveryType.isVisible()).toBe(true);
			expect(await recoveryDescription()).not.toContain(
				"Recovery email is required.",
			);
			expect(await recoveryDescription()).toContain("Use an email address.");
			await recovery.fill("recovery@example.com");
			expect(await recoveryType.isVisible()).toBe(false);
			await email.fill("");
			await email.pressSequentially("person@example.com");
			expect((await fixture()).inputValues.at(-1)).toEqual({
				source: "keyboard",
				value: "person@example.com",
			});
			expect(
				await page
					.locator("form")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(true);

			await notes.pressSequentially("First line");
			await notes.press("Enter");
			await notes.pressSequentially("Second line");
			expect(await notes.inputValue()).toBe("First line\nSecond line");
			expect((await fixture()).formEntries).toEqual([]);
			expect((await fixture()).textareaValues.at(-1)).toEqual({
				source: "keyboard",
				value: "First line\nSecond line",
			});

			const controlled = page.getByRole("textbox", {
				name: "Controlled value",
			});
			expect(
				await page
					.getByRole("textbox", { name: "Referenced value" })
					.inputValue(),
			).toBe("linked");
			const adorned = page.getByRole("textbox", {
				name: "Repository installation identifier with a deliberately long label",
			});
			await page.locator('[data-slot="input-leading"]').click();
			expect(
				await adorned.evaluate((element) => element === document.activeElement),
			).toBe(true);
			const adornedGroup = page
				.locator('[data-slot="input-group"]')
				.filter({ has: adorned });
			expect(
				await adornedGroup.evaluate(
					(element) => getComputedStyle(element).outlineWidth,
				),
			).toBe("2px");
			expect(
				await adorned.evaluate(
					(element) => getComputedStyle(element).outlineWidth,
				),
			).toBe("0px");
			const copyAdorned = page.getByRole("button", {
				name: "Copy adorned value",
			});
			await adorned.press("Tab");
			expect(
				await copyAdorned.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			expect(
				await adornedGroup.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).toBe("none");
			expect(
				await copyAdorned.evaluate(
					(element) => getComputedStyle(element).outlineWidth,
				),
			).toBe("2px");
			await controlled.fill("proposed");
			expect(await controlled.inputValue()).toBe("fixed");
			expect((await fixture()).controlledValues.at(-1)?.value).toBe("proposed");

			const readOnlyInput = page.getByRole("textbox", {
				name: "Read-only token",
			});
			await readOnlyInput.focus();
			expect(await readOnlyInput.isDisabled()).toBe(false);
			expect(await readOnlyInput.getAttribute("disabled")).toBeNull();
			expect(await readOnlyInput.getAttribute("data-disabled")).toBeNull();
			expect(await readOnlyInput.getAttribute("data-readonly")).toBe("");
			await readOnlyInput.pressSequentially("changed");
			expect(await readOnlyInput.inputValue()).toBe("locked");
			const readOnlyTextarea = page.getByRole("textbox", {
				name: "Read-only note",
			});
			expect(await readOnlyTextarea.isDisabled()).toBe(false);
			expect(await readOnlyTextarea.getAttribute("data-disabled")).toBeNull();
			expect(await readOnlyTextarea.getAttribute("data-readonly")).toBe("");
			await readOnlyTextarea.pressSequentially("changed");
			expect(await readOnlyTextarea.inputValue()).toBe("kept");
			expect((await fixture()).readOnlyChanges).toEqual([]);

			const disabled = page.getByRole("textbox", { name: "Disabled value" });
			expect(await disabled.isDisabled()).toBe(true);
			const agentResult = await page.evaluate<{ ok: boolean }>(async () => {
				const fixtureWindow = window as unknown as FieldFixtureWindow;
				const input = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Email");
				const textarea = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Notes");
				const controlled = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Controlled value");
				if (!input || !textarea || !controlled) {
					throw new Error("Fields were not exposed");
				}
				return fixtureWindow.agent.act({
					steps: [
						{ action: "setValue", args: ["agent@example.com"], ref: input.ref },
						{ action: "setValue", args: ["Agent note"], ref: textarea.ref },
						{
							action: "setValue",
							args: ["agent-proposed"],
							ref: controlled.ref,
						},
					],
				});
			});
			expect(agentResult.ok).toBe(true);
			expect((await fixture()).inputValues.at(-1)).toEqual({
				source: "agent",
				value: "agent@example.com",
			});
			expect((await fixture()).textareaValues.at(-1)).toEqual({
				source: "agent",
				value: "Agent note",
			});
			expect((await fixture()).controlledValues.at(-1)).toEqual({
				source: "agent",
				value: "agent-proposed",
			});
			expect(await controlled.inputValue()).toBe("fixed");
			const agentActions = await page.evaluate(() => {
				const fixtureWindow = window as unknown as FieldFixtureWindow;
				return fixtureWindow.agent
					.snapshot()
					.filter(
						(component) =>
							component.actions.includes("setValue") &&
							["Email", "Notes", "Controlled value"].includes(
								component.label ?? "",
							),
					)
					.map((component) => ({
						actions: component.actions,
						label: component.label,
					}));
			});
			expect(agentActions).toEqual([
				{ actions: ["setValue", "clear"], label: "Email" },
				{ actions: ["setValue", "clear"], label: "Notes" },
				{ actions: ["setValue", "clear"], label: "Controlled value" },
			]);

			const blockedAgentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as FieldFixtureWindow;
				const components = fixtureWindow.agent.snapshot();
				const targets = [
					{ component: "input", label: "Read-only token" },
					{ component: "textarea", label: "Read-only note" },
					{ component: "input", label: "Disabled value" },
				].map((target) =>
					components.find(
						(component) =>
							component.component === target.component &&
							component.label === target.label,
					),
				);
				if (targets.some((target) => !target)) {
					throw new Error("Unavailable fields were not exposed");
				}
				return Promise.all(
					targets.map((target) =>
						fixtureWindow.agent.act({
							steps: [
								{
									action: "setValue",
									args: ["changed"],
									ref: target?.ref ?? "",
								},
							],
						}),
					),
				);
			});
			const unavailableAgentState = await page.evaluate(() => {
				const fixtureWindow = window as unknown as FieldFixtureWindow;
				return fixtureWindow.agent
					.snapshot()
					.filter((component) =>
						["Read-only token", "Read-only note", "Disabled value"].includes(
							component.label ?? "",
						),
					)
					.filter((component) =>
						["input", "textarea"].includes(component.component),
					)
					.map((component) => ({
						actions: component.actions,
						disabled: component.disabled ?? false,
						label: component.label,
						readOnly: component.readOnly ?? false,
					}));
			});
			expect(unavailableAgentState).toEqual([
				{
					actions: [],
					disabled: true,
					label: "Read-only token",
					readOnly: false,
				},
				{
					actions: [],
					disabled: true,
					label: "Read-only note",
					readOnly: false,
				},
				{
					actions: [],
					disabled: true,
					label: "Disabled value",
					readOnly: false,
				},
			]);
			expect(blockedAgentResults.map((result) => result.ok)).toEqual([
				false,
				false,
				false,
			]);
			expect((await fixture()).readOnlyChanges).toEqual([]);
			expect(
				await page
					.locator("form")
					.evaluate((form) =>
						[...new FormData(form as HTMLFormElement).keys()].includes(
							"disabled-value",
						),
					),
			).toBe(false);

			await page.getByRole("button", { name: "Enable details" }).click();
			expect(await disabled.isDisabled()).toBe(false);
			expect(await disabled.getAttribute("data-disabled")).toBeNull();
			const enabledAgentResult = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as FieldFixtureWindow;
				const target = fixtureWindow.agent
					.snapshot()
					.find(
						(component) =>
							component.component === "input" &&
							component.label === "Disabled value" &&
							component.actions.includes("setValue"),
					);
				if (!target) throw new Error("Enabled field was not actionable");
				return fixtureWindow.agent.act({
					steps: [{ action: "setValue", args: ["included"], ref: target.ref }],
				});
			});
			expect(enabledAgentResult.ok).toBe(true);
			expect(await disabled.inputValue()).toBe("included");

			await email.press("Enter");
			expect((await fixture()).formEntries).toEqual([
				["email", "agent@example.com"],
				["notes", "Agent note"],
				["recovery-email", "recovery@example.com"],
				["token", "locked"],
				["readonly-note", "kept"],
				["disabled-value", "included"],
			]);

			await page.getByRole("button", { name: "Reset" }).click();
			await recoveryType.waitFor({ state: "hidden" });
			await page.waitForTimeout(50);
			expect(await email.inputValue()).toBe("bad");
			expect(await notes.inputValue()).toBe("");
			expect(await recovery.inputValue()).toBe("");
			expect(await recoveryRequired.isVisible()).toBe(false);
			expect(await recoveryType.isVisible()).toBe(false);
			expect((await fixture()).inputValues.at(-1)).toEqual({
				source: "programmatic",
				value: "bad",
			});
			expect((await fixture()).textareaValues.at(-1)).toEqual({
				source: "programmatic",
				value: "",
			});
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
