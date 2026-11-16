import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface ToggleFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	checkboxChanges: Array<{
		checked: boolean | "indeterminate";
		source: string;
	}>;
	controlledCheckboxChanges: Array<{
		checked: boolean | "indeterminate";
		source: string;
	}>;
	controlledGroupChanges: Array<{ source: string; value: string[] }>;
	controlledSwitchChanges: Array<{ checked: boolean; source: string }>;
	disabledGroupChanges: Array<{ source: string; value: string[] }>;
	formEntries: Array<[string, FormDataEntryValue]>;
	groupChanges: Array<{ source: string; value: string[] }>;
	readOnlyChanges: string[];
	readOnlyGroupChanges: Array<{ source: string; value: string[] }>;
	requiredGroupChanges: Array<{ source: string; value: string[] }>;
	switchChanges: Array<{ checked: boolean; source: string }>;
}

test("checkboxes and switches share keyboard, form, pending, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-toggles-"));
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
			import { Checkbox, CheckboxGroup } from ${JSON.stringify(fileURLToPath(new URL("./checkbox.tsx", import.meta.url)))};
			import { Switch } from ${JSON.stringify(fileURLToPath(new URL("./switch.tsx", import.meta.url)))};

			window.checkboxChanges = [];
			window.controlledCheckboxChanges = [];
			window.controlledGroupChanges = [];
			window.controlledSwitchChanges = [];
			window.disabledGroupChanges = [];
			window.groupChanges = [];
			window.readOnlyChanges = [];
			window.readOnlyGroupChanges = [];
			window.requiredGroupChanges = [];
			window.switchChanges = [];
			window.formEntries = [];
			window.agent = createAgent({ allow: () => true });
			createRoot(document.getElementById("root")).render(createElement(
				"main",
				{ className: "tripwire" },
				createElement("form", { id: "external-form" },
					createElement("button", { type: "submit" }, "Submit external"),
					createElement("button", { type: "reset" }, "Reset external"),
				),
				createElement(
				"form",
				{
					"data-main-form": "",
					onSubmit: (event) => {
						event.preventDefault();
						window.formEntries = [...new FormData(event.currentTarget).entries()];
					},
				},
				createElement(Checkbox, {
					description: "Product and security news",
					label: "Email updates",
					name: "updates",
					onCheckedChange: (checked, details) => window.checkboxChanges.push({ checked, source: details.source }),
					value: "email",
				}),
				createElement(Checkbox, {
					ariaLabel: "External checkbox",
					ariaDescribedBy: "external-checkbox-help",
					defaultChecked: true,
					form: "external-form",
					name: "external-check",
					value: "yes",
				}),
				createElement("span", { id: "external-checkbox-help" }, "External choice help"),
				createElement(Checkbox, {
					ariaLabel: "Compact checkbox",
					size: "small",
				}),
				createElement(Checkbox, {
					defaultChecked: "indeterminate",
					label: "Select all",
				}),
				createElement(Checkbox, {
					disabled: true,
					label: "Unavailable option",
					onCheckedChange: (checked, details) => window.checkboxChanges.push({ checked, source: details.source }),
				}),
				createElement(Checkbox, {
					checked: false,
					label: "Controlled checkbox",
					onCheckedChange: (checked, details) => window.controlledCheckboxChanges.push({ checked, source: details.source }),
				}),
				createElement(Checkbox, {
					defaultChecked: true,
					label: "Read-only checkbox",
					name: "readonly-check",
					onCheckedChange: () => window.readOnlyChanges.push("checkbox"),
					readOnly: true,
					value: "locked",
				}),
				createElement(Checkbox, {
					description: "Choose a valid option",
					invalid: true,
					label: "Invalid checkbox",
				}),
				createElement(CheckboxGroup, {
					ariaLabel: "Repository access",
					defaultValue: ["read"],
					name: "access",
					onValueChange: (value, details) => window.groupChanges.push({ source: details.source, value }),
					options: [
						{ label: "Read", value: "read" },
						{ label: "Write", value: "write" },
						{ disabled: true, label: "Admin", value: "admin" },
					],
				}),
				createElement(CheckboxGroup, {
					ariaLabel: "Controlled access",
					name: "controlled-access",
					onValueChange: (value, details) => window.controlledGroupChanges.push({ source: details.source, value }),
					options: [
						{ label: "Controlled read", value: "read" },
						{ label: "Controlled write", value: "write" },
					],
					value: ["read"],
				}),
				createElement(CheckboxGroup, {
					ariaLabel: "Disabled access",
					disabled: true,
					name: "disabled-access",
					onValueChange: (value, details) => window.disabledGroupChanges.push({ source: details.source, value }),
					options: [{ label: "Disabled view", value: "view" }],
				}),
				createElement(CheckboxGroup, {
					ariaLabel: "Read-only access",
					defaultValue: ["observe"],
					name: "readonly-access",
					onValueChange: (value, details) => window.readOnlyGroupChanges.push({ source: details.source, value }),
					options: [
						{ label: "Observe", value: "observe" },
						{ label: "Manage", value: "manage" },
					],
					readOnly: true,
				}),
				createElement(CheckboxGroup, {
					ariaLabel: "Required access",
					name: "required-access",
					onValueChange: (value, details) => window.requiredGroupChanges.push({ source: details.source, value }),
					options: [{ label: "Required choice", value: "required" }],
					required: true,
				}),
				createElement(CheckboxGroup, {
					ariaLabel: "Invalid access",
					invalid: true,
					options: [{ label: "Invalid group option", value: "invalid" }],
				}),
				createElement(Switch, {
					description: "Use fewer transitions",
					label: "Reduce motion",
					name: "motion",
					onCheckedChange: (checked, details) => window.switchChanges.push({ checked, source: details.source }),
				}),
				createElement(Switch, {
					ariaLabel: "External switch",
					defaultChecked: true,
					form: "external-form",
					name: "external-switch",
					value: "enabled",
				}),
				createElement(Switch, {
					label: "Saving preference",
					onCheckedChange: (checked, details) => window.switchChanges.push({ checked, source: details.source }),
					pending: true,
				}),
				createElement(Switch, {
					checked: false,
					label: "Controlled switch",
					onCheckedChange: (checked, details) => window.controlledSwitchChanges.push({ checked, source: details.source }),
				}),
				createElement(Switch, {
					defaultChecked: true,
					label: "Compact switch",
					size: "small",
				}),
				createElement(Switch, {
					defaultChecked: true,
					label: "Read-only switch",
					name: "readonly-switch",
					onCheckedChange: () => window.readOnlyChanges.push("switch"),
					readOnly: true,
				}),
				createElement(Switch, {
					description: "Resolve the setting error",
					invalid: true,
					label: "Invalid switch",
				}),
				createElement("button", { type: "submit" }, "Submit"),
				createElement("button", { type: "reset" }, "Reset"),
				),
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
			throw new Error("Toggle browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://toggles.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://toggles.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://toggles.test/") {
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
			await page.goto("http://toggles.test/");
			const externalCheckbox = page.getByRole("checkbox", {
				name: "External checkbox",
			});
			const emailField = page
				.locator('[data-slot="checkbox-field"]')
				.filter({ has: page.getByText("Email updates", { exact: true }) });
			const emailLabel = emailField.locator('[data-slot="checkbox-label"]');
			const emailDescription = emailField.locator(
				'[data-slot="checkbox-description"]',
			);
			const emailControl = emailField.locator('[data-slot="checkbox"]');
			const motionField = page
				.locator('[data-slot="switch-field"]')
				.filter({ has: page.getByText("Reduce motion", { exact: true }) });
			const motionLabel = motionField.locator('[data-slot="switch-label"]');
			const motionDescription = motionField.locator(
				'[data-slot="switch-description"]',
			);
			const motionControl = motionField.locator('[data-slot="switch"]');
			const compact = page.getByRole("switch", { name: "Compact switch" });
			const compactThumb = compact.locator('[data-slot="switch-thumb"]');
			const pendingThumb = page
				.getByRole("switch", { name: "Saving preference" })
				.locator('[data-slot="switch-thumb"]');

			expect(await page.locator("label label").count()).toBe(0);
			const compactCheckbox = page.getByRole("checkbox", {
				name: "Compact checkbox",
			});
			expect(
				await compactCheckbox.evaluate((element) => [
					element.getBoundingClientRect().width,
					element.getBoundingClientRect().height,
					element.parentElement?.getBoundingClientRect().width,
				]),
			).toEqual([16, 16, 16]);
			expect(
				await externalCheckbox.evaluate((element) => [
					element.getBoundingClientRect().width,
					element.parentElement?.getBoundingClientRect().width,
				]),
			).toEqual([20, 20]);
			await compactCheckbox.press("Space");
			expect(await compactCheckbox.isChecked()).toBe(true);

			expect(
				await externalCheckbox.evaluate(
					(element) => element.parentElement?.tagName,
				),
			).toBe("SPAN");
			expect(await externalCheckbox.getAttribute("aria-describedby")).toBe(
				"external-checkbox-help",
			);
			const [emailBox, emailLabelBox, emailDescriptionBox] = await Promise.all([
				emailControl.boundingBox(),
				emailLabel.boundingBox(),
				emailDescription.boundingBox(),
			]);
			expect(emailBox).toMatchObject({ height: 20, width: 20 });
			expect(emailLabelBox?.x).toBe(emailDescriptionBox?.x);
			expect(
				Math.round(
					(emailLabelBox?.x ?? 0) - (emailBox?.x ?? 0) - (emailBox?.width ?? 0),
				),
			).toBe(8);
			const [motionBox, motionLabelBox, motionDescriptionBox] =
				await Promise.all([
					motionControl.boundingBox(),
					motionLabel.boundingBox(),
					motionDescription.boundingBox(),
				]);
			expect(motionBox).toMatchObject({ height: 20, width: 36 });
			expect(motionLabelBox?.x).toBe(motionDescriptionBox?.x);
			expect(await compact.boundingBox()).toMatchObject({
				height: 16,
				width: 28,
			});
			expect(await compactThumb.boundingBox()).toMatchObject({
				height: 12,
				width: 12,
			});
			const lightCompactFill = await compact.evaluate(
				(element) => getComputedStyle(element).backgroundImage,
			);
			expect(lightCompactFill).toContain("rgb(61, 61, 61) 50%");
			const compactThumbFill = () =>
				compactThumb.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				);
			expect(await compactThumbFill()).toBe("rgba(255, 255, 255, 0.92)");
			expect(
				await pendingThumb.evaluate(
					(element) => getComputedStyle(element, "::after").animationName,
				),
			).toBe("tripwire-switch-pending");
			const invalidCheckbox = page.getByRole("checkbox", {
				name: "Invalid checkbox",
			});
			const invalidGroupOption = page.getByRole("checkbox", {
				name: "Invalid group option",
			});
			const invalidSwitch = page.getByRole("switch", {
				name: "Invalid switch",
			});
			expect(await invalidCheckbox.getAttribute("aria-invalid")).toBe("true");
			expect(
				await invalidCheckbox.getAttribute("aria-describedby"),
			).not.toBeNull();
			expect(await invalidGroupOption.getAttribute("aria-invalid")).toBe(
				"true",
			);
			expect(await invalidSwitch.getAttribute("aria-invalid")).toBe("true");
			expect(
				await invalidCheckbox.evaluate(
					(element) => getComputedStyle(element).borderColor,
				),
			).not.toBe(
				await emailControl.evaluate(
					(element) => getComputedStyle(element).borderColor,
				),
			);
			const pendingField = page
				.locator('[data-slot="switch-field"]')
				.filter({ has: page.getByText("Saving preference", { exact: true }) });
			expect(await pendingField.getAttribute("data-disabled")).not.toBeNull();
			expect(
				await pendingField.evaluate(
					(element) => getComputedStyle(element).cursor,
				),
			).toBe("not-allowed");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as ToggleFixtureWindow;
					return {
						checkboxChanges: value.checkboxChanges,
						controlledCheckboxChanges: value.controlledCheckboxChanges,
						controlledGroupChanges: value.controlledGroupChanges,
						controlledSwitchChanges: value.controlledSwitchChanges,
						disabledGroupChanges: value.disabledGroupChanges,
						formEntries: value.formEntries,
						groupChanges: value.groupChanges,
						readOnlyChanges: value.readOnlyChanges,
						readOnlyGroupChanges: value.readOnlyGroupChanges,
						requiredGroupChanges: value.requiredGroupChanges,
						switchChanges: value.switchChanges,
					};
				});

			const email = page.getByRole("checkbox", { name: "Email updates" });
			expect(await email.getAttribute("aria-describedby")).not.toBeNull();
			await email.click();
			await email.press("Space");
			expect((await fixture()).checkboxChanges).toEqual([
				{ checked: true, source: "mouse" },
				{ checked: false, source: "keyboard" },
			]);

			const mixed = page.getByRole("checkbox", { name: "Select all" });
			expect(await mixed.getAttribute("aria-checked")).toBe("mixed");
			await mixed.click();
			expect(await mixed.isChecked()).toBe(true);

			const unavailable = page.getByRole("checkbox", {
				name: "Unavailable option",
			});
			expect(await unavailable.isDisabled()).toBe(true);
			await unavailable.click({ force: true });
			expect((await fixture()).checkboxChanges).toHaveLength(2);
			const controlledCheckbox = page.getByRole("checkbox", {
				name: "Controlled checkbox",
			});
			await controlledCheckbox.click();
			expect(await controlledCheckbox.isChecked()).toBe(false);
			expect((await fixture()).controlledCheckboxChanges).toEqual([
				{ checked: true, source: "mouse" },
			]);
			const readOnlyCheckbox = page.getByRole("checkbox", {
				name: "Read-only checkbox",
			});
			await readOnlyCheckbox.focus();
			expect(
				await readOnlyCheckbox.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await readOnlyCheckbox.click();
			await readOnlyCheckbox.press("Space");
			expect(await readOnlyCheckbox.isChecked()).toBe(true);
			expect((await fixture()).readOnlyChanges).toEqual([]);

			const write = page.getByRole("checkbox", { exact: true, name: "Write" });
			await write.press("Space");
			expect((await fixture()).groupChanges).toEqual([
				{ source: "keyboard", value: ["read", "write"] },
			]);
			const admin = page.getByRole("checkbox", { name: "Admin" });
			expect(await admin.isDisabled()).toBe(true);
			await admin.click({ force: true });
			await admin.press("Space");
			expect(await admin.isChecked()).toBe(false);
			expect((await fixture()).groupChanges).toHaveLength(1);

			const controlledWrite = page.getByRole("checkbox", {
				name: "Controlled write",
			});
			await controlledWrite.click();
			expect(await controlledWrite.isChecked()).toBe(false);
			expect((await fixture()).controlledGroupChanges).toEqual([
				{ source: "mouse", value: ["read", "write"] },
			]);

			const disabledView = page.getByRole("checkbox", {
				name: "Disabled view",
			});
			expect(await disabledView.isDisabled()).toBe(true);
			expect(
				await disabledView.locator("xpath=..").getAttribute("data-disabled"),
			).not.toBeNull();
			await disabledView.click({ force: true });
			await disabledView.press("Space");
			expect(await disabledView.isChecked()).toBe(false);
			expect((await fixture()).disabledGroupChanges).toEqual([]);

			const observe = page.getByRole("checkbox", { name: "Observe" });
			const manage = page.getByRole("checkbox", { name: "Manage" });
			await observe.focus();
			expect(
				await observe.evaluate((element) => element === document.activeElement),
			).toBe(true);
			await observe.click();
			await manage.press("Space");
			expect(await observe.isChecked()).toBe(true);
			expect(await manage.isChecked()).toBe(false);
			expect((await fixture()).readOnlyGroupChanges).toEqual([]);

			const requiredChoice = page.getByRole("checkbox", {
				name: "Required choice",
			});
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(false);
			await requiredChoice.press("Space");
			expect((await fixture()).requiredGroupChanges).toEqual([
				{ source: "keyboard", value: ["required"] },
			]);
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(true);

			const motion = page.getByRole("switch", { name: "Reduce motion" });
			expect(await motion.getAttribute("aria-describedby")).not.toBeNull();
			await motion.click();
			await motion.press("Space");
			expect((await fixture()).switchChanges).toEqual([
				{ checked: true, source: "mouse" },
				{ checked: false, source: "keyboard" },
			]);

			const pending = page.getByRole("switch", { name: "Saving preference" });
			expect(await pending.getAttribute("aria-busy")).toBe("true");
			expect(await pending.isDisabled()).toBe(true);
			await pending.click({ force: true });
			expect((await fixture()).switchChanges).toHaveLength(2);
			const controlledSwitch = page.getByRole("switch", {
				name: "Controlled switch",
			});
			await controlledSwitch.press("Space");
			expect(await controlledSwitch.isChecked()).toBe(false);
			expect((await fixture()).controlledSwitchChanges).toEqual([
				{ checked: true, source: "keyboard" },
			]);
			const readOnlySwitch = page.getByRole("switch", {
				name: "Read-only switch",
			});
			await readOnlySwitch.focus();
			expect(
				await readOnlySwitch.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await readOnlySwitch.click();
			await readOnlySwitch.press("Space");
			expect(await readOnlySwitch.isChecked()).toBe(true);
			expect((await fixture()).readOnlyChanges).toEqual([]);

			await motion.press("Enter");
			expect(await motion.isChecked()).toBe(false);
			expect((await fixture()).switchChanges).toHaveLength(2);
			expect((await fixture()).formEntries).toEqual([
				["readonly-check", "locked"],
				["access", "read"],
				["access", "write"],
				["controlled-access", "read"],
				["readonly-access", "observe"],
				["required-access", "required"],
				["readonly-switch", "on"],
			]);

			const externalSwitch = page.getByRole("switch", {
				name: "External switch",
			});
			await externalCheckbox.click();
			await externalSwitch.click();
			expect(await externalCheckbox.isChecked()).toBe(false);
			expect(await externalSwitch.isChecked()).toBe(false);
			await page
				.getByRole("button", { exact: true, name: "Reset external" })
				.click();
			await page.waitForTimeout(50);
			expect(await externalCheckbox.isChecked()).toBe(true);
			expect(await externalSwitch.isChecked()).toBe(true);

			await page.getByRole("button", { exact: true, name: "Reset" }).click();
			await page.waitForTimeout(50);
			expect(await email.isChecked()).toBe(false);
			expect(await mixed.getAttribute("aria-checked")).toBe("mixed");
			expect(await write.isChecked()).toBe(false);
			expect(
				await page
					.getByRole("checkbox", { exact: true, name: "Read" })
					.isChecked(),
			).toBe(true);
			expect(await motion.isChecked()).toBe(false);
			expect(await controlledCheckbox.isChecked()).toBe(false);
			expect(await controlledSwitch.isChecked()).toBe(false);
			expect(await readOnlyCheckbox.isChecked()).toBe(true);
			expect(await readOnlySwitch.isChecked()).toBe(true);
			expect((await fixture()).groupChanges.at(-1)).toEqual({
				source: "programmatic",
				value: ["read"],
			});
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(false);
			await requiredChoice.click();

			const agentResult = await page.evaluate<{ ok: boolean }>(async () => {
				const fixtureWindow = window as unknown as ToggleFixtureWindow;
				const checkbox = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Email updates");
				const toggle = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Reduce motion");
				if (!checkbox || !toggle)
					throw new Error("Toggle controls were not exposed");
				return fixtureWindow.agent.act({
					steps: [
						{ action: "setChecked", args: [true], ref: checkbox.ref },
						{ action: "setChecked", args: [true], ref: toggle.ref },
					],
				});
			});
			expect(agentResult.ok).toBe(true);
			await page.waitForTimeout(50);
			expect(await email.isChecked()).toBe(true);
			expect(await motion.isChecked()).toBe(true);
			expect(await page.locator('input[name="updates"]').isChecked()).toBe(
				true,
			);
			expect(await page.locator('input[name="motion"]').isChecked()).toBe(true);
			expect(
				await page.locator('input[name="updates"]').evaluate((input) => {
					const control = input as HTMLInputElement;
					return {
						disabled: control.disabled,
						form: control.form?.getAttribute("data-main-form") ?? null,
						name: control.name,
					};
				}),
			).toEqual({ disabled: false, form: "", name: "updates" });
			expect((await fixture()).checkboxChanges.at(-1)).toEqual({
				checked: true,
				source: "agent",
			});
			expect((await fixture()).switchChanges.at(-1)).toEqual({
				checked: true,
				source: "agent",
			});
			const blockedAgentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as ToggleFixtureWindow;
				const components = fixtureWindow.agent.snapshot();
				const disabled = components.find(
					(component) => component.label === "Unavailable option",
				);
				const pendingSwitch = components.find(
					(component) => component.label === "Saving preference",
				);
				const disabledOption = components.find(
					(component) => component.label === "Admin",
				);
				const readOnlyOption = components.find(
					(component) => component.label === "Manage",
				);
				if (!disabled || !pendingSwitch || !disabledOption || !readOnlyOption) {
					throw new Error("Disabled toggle controls were not exposed");
				}
				return Promise.all([
					fixtureWindow.agent.act({
						steps: [{ action: "setChecked", args: [true], ref: disabled.ref }],
					}),
					fixtureWindow.agent.act({
						steps: [
							{ action: "setChecked", args: [true], ref: pendingSwitch.ref },
						],
					}),
					fixtureWindow.agent.act({
						steps: [
							{ action: "setChecked", args: [true], ref: disabledOption.ref },
						],
					}),
					fixtureWindow.agent.act({
						steps: [
							{ action: "setChecked", args: [true], ref: readOnlyOption.ref },
						],
					}),
				]);
			});
			expect(blockedAgentResults.map((result) => result.ok)).toEqual([
				false,
				false,
				false,
				false,
			]);
			expect((await fixture()).checkboxChanges).toHaveLength(3);
			expect((await fixture()).switchChanges).toHaveLength(3);
			expect((await fixture()).groupChanges).toHaveLength(2);
			expect((await fixture()).readOnlyGroupChanges).toEqual([]);
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) =>
						[...new FormData(form as HTMLFormElement).entries()].map(
							([name, value]) => [name, String(value)],
						),
					),
			).toContainEqual(["updates", "email"]);
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) =>
						[...new FormData(form as HTMLFormElement).entries()].map(
							([name, value]) => [name, String(value)],
						),
					),
			).toContainEqual(["motion", "on"]);

			expect(
				await page
					.locator("#external-form")
					.evaluate((form) =>
						[...new FormData(form as HTMLFormElement).entries()].map(
							([name, value]) => [name, String(value)],
						),
					),
			).toEqual([
				["external-check", "yes"],
				["external-switch", "enabled"],
			]);
			await page.getByRole("button", { exact: true, name: "Submit" }).click();
			expect((await fixture()).formEntries).toEqual([
				["updates", "email"],
				["readonly-check", "locked"],
				["access", "read"],
				["controlled-access", "read"],
				["readonly-access", "observe"],
				["required-access", "required"],
				["motion", "on"],
				["readonly-switch", "on"],
			]);

			await page
				.locator("main.tripwire")
				.evaluate((element) => element.setAttribute("data-theme", "dark"));
			const darkCompactFill = await compact.evaluate(
				(element) => getComputedStyle(element).backgroundImage,
			);
			expect(darkCompactFill).toContain("linear-gradient");
			expect(darkCompactFill).not.toBe(lightCompactFill);
			expect(await compactThumbFill()).toBe("rgba(5, 5, 5, 0.88)");
			expect(
				await emailLabel.evaluate((element) => getComputedStyle(element).color),
			).not.toBe(
				await emailDescription.evaluate(
					(element) => getComputedStyle(element).color,
				),
			);

			await page.emulateMedia({ forcedColors: "active" });
			expect(
				await compact.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await compact.evaluate(
					(element) => getComputedStyle(element).backgroundImage,
				),
			).toBe("none");

			await page.emulateMedia({
				forcedColors: "none",
				reducedMotion: "reduce",
			});
			expect(
				await compactThumb.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0s");
			expect(
				await pendingThumb.evaluate(
					(element) => getComputedStyle(element, "::after").animationName,
				),
			).toBe("none");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
