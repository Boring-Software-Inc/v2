import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface SelectFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{
			actions: string[];
			component: string;
			label?: string;
			ref: string;
			value?: unknown;
		}>;
	};
	controlledChanges: Array<{ source: string; value: string | null }>;
	disabledChanges: Array<{ source: string; value: string | null }>;
	externalEntries: Array<[string, FormDataEntryValue]>;
	formEntries: Array<[string, FormDataEntryValue]>;
	humanOnlyChanges: Array<string>;
	nativeChanges: Array<{ source: string; value: string | null }>;
	planChanges: Array<{ source: string; value: string | null }>;
	readOnlyChanges: Array<{ source: string; value: string | null }>;
	requiredChanges: Array<{ source: string; value: string | null }>;
}

test("selects own finite state, forms, geometry, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-select-"));
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
			import { AgentBoundary } from ${JSON.stringify(fileURLToPath(new URL("./agent-policy.tsx", import.meta.url)))};
			import { Button } from ${JSON.stringify(fileURLToPath(new URL("./button.tsx", import.meta.url)))};
			import { Organization } from ${JSON.stringify(fileURLToPath(new URL("./icon.tsx", import.meta.url)))};
			import { Select } from ${JSON.stringify(fileURLToPath(new URL("./select.tsx", import.meta.url)))};

			window.controlledChanges = [];
			window.disabledChanges = [];
			window.externalEntries = [];
			window.formEntries = [];
			window.humanOnlyChanges = [];
			window.nativeChanges = [];
			window.planChanges = [];
			window.readOnlyChanges = [];
			window.requiredChanges = [];
			window.agent = createAgent({ allow: () => true });

			const planOptions = [
				{ icon: Organization, label: "Starter", metadata: "Free", value: "starter" },
				{ description: "For growing teams.", label: "Team", metadata: "Popular", value: "team" },
				{ disabled: true, label: "Enterprise", value: "enterprise" },
			];

			createRoot(document.getElementById("root")).render(createElement(
				Fragment,
				null,
				createElement(AgentBoundary, { visibility: "hidden" },
					createElement(Select, {
						ariaLabel: "Member role",
						defaultValue: "viewer",
						onValueChange: (value) => window.humanOnlyChanges.push(value),
						options: [{ label: "Viewer", value: "viewer" }, { label: "Manager", value: "manager" }],
					}),
					createElement(Button, { onAction: () => window.humanOnlyChanges.push("approved") }, "Approve appeal"),
				),
				createElement("form", {
					id: "external-form",
					onSubmit: (event) => {
						event.preventDefault();
						window.externalEntries = [...new FormData(event.currentTarget).entries()];
					},
				}, createElement("button", { type: "submit" }, "Submit external")),
				createElement(Select, {
					ariaLabel: "Empty native plan",
					form: "external-form",
					mode: "native",
					name: "empty-native-plan",
					options: [{ label: "Outside native", value: "outside-native" }],
					value: null,
				}),
				createElement(Select, {
					ariaLabel: "External plan",
					defaultValue: "outside",
					form: "external-form",
					name: "external-plan",
					options: [{ label: "Outside", value: "outside" }],
				}),
				createElement("form", {
					"data-main-form": "",
					id: "main-form",
					onSubmit: (event) => {
						event.preventDefault();
						window.formEntries = [...new FormData(event.currentTarget).entries()];
					},
				},
					createElement(Select, {
						ariaLabel: "Plan",
						defaultValue: "starter",
						name: "plan",
						onValueChange: (value, details) => window.planChanges.push({ source: details.source, value }),
						options: planOptions,
						placeholder: "Choose a plan",
					}),
					createElement(Select, {
						ariaLabel: "Controlled plan",
						onValueChange: (value, details) => window.controlledChanges.push({ source: details.source, value }),
						options: planOptions,
						value: "starter",
					}),
					createElement(Select, {
						ariaLabel: "Read-only plan",
						defaultValue: "starter",
						name: "readonly-plan",
						onValueChange: (value, details) => window.readOnlyChanges.push({ source: details.source, value }),
						options: planOptions,
						readOnly: true,
					}),
					createElement(Select, {
						ariaLabel: "Disabled plan",
						defaultValue: "starter",
						disabled: true,
						name: "disabled-plan",
						onValueChange: (value, details) => window.disabledChanges.push({ source: details.source, value }),
						options: planOptions,
					}),
					createElement(Select, {
						ariaLabel: "Required plan",
						name: "required-plan",
						onValueChange: (value, details) => window.requiredChanges.push({ source: details.source, value }),
						options: planOptions,
						placeholder: "Choose required",
						required: true,
					}),
					createElement(Select, {
						ariaLabel: "Native plan",
						defaultValue: "starter",
						mode: "native",
						name: "native-plan",
						onValueChange: (value, details) => window.nativeChanges.push({ source: details.source, value }),
						options: planOptions,
					}),
					createElement("button", { type: "submit" }, "Submit"),
					createElement("button", { type: "reset" }, "Reset"),
				),
				createElement(Select, {
					ariaLabel: "Small plan",
					defaultValue: "starter",
					options: planOptions,
					size: "small",
				}),
				createElement(Select, {
					ariaLabel: "Large plan",
					defaultValue: "starter",
					options: planOptions,
					size: "large",
				}),
				createElement("div", { style: { width: "150px" } },
					createElement(Select, {
						ariaLabel: "Overflow plan",
						defaultValue: "long",
						options: [{ label: "A deliberately long plan label", value: "long" }],
					}),
				),
				createElement(Select, {
					ariaLabel: "Invalid plan",
					invalid: true,
					options: planOptions,
				}),
				createElement(Select, {
					ariaLabel: "Required native plan",
					form: "main-form",
					invalid: true,
					mode: "native",
					name: "required-native-plan",
					options: planOptions,
					placeholder: "Choose native required",
					required: true,
				}),
				createElement(Select, {
					ariaLabel: "Disabled native plan",
					defaultValue: "starter",
					disabled: true,
					form: "main-form",
					mode: "native",
					name: "disabled-native-plan",
					options: planOptions,
				}),
				createElement(Select, {
					ariaLabel: "No-loop plan",
					defaultValue: "team",
					loop: false,
					options: planOptions,
				}),
				createElement(Select, {
					ariaLabel: "Keyboard plan",
					defaultValue: "starter",
					options: planOptions,
				}),
				createElement(Select, {
					ariaLabel: "Empty plan",
					emptyMessage: "No plans available",
					options: [],
				}),
				createElement(Select, {
					ariaLabel: "Long list",
					defaultValue: "option-1",
					options: Array.from({ length: 24 }, (_, index) => ({
						description: index === 0 ? "averylongunbrokensecondarydescriptionthatmustwrap" : undefined,
						label: \`Option \${index + 1}\`,
						metadata: index === 0 ? "averylongunbrokenmetadatavalue" : undefined,
						value: \`option-\${index + 1}\`,
					})),
				}),
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
			throw new Error("Select fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://select.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://select.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://select.test/") {
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
			await page.goto("http://select.test/");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as SelectFixtureWindow;
					return {
						controlledChanges: value.controlledChanges,
						disabledChanges: value.disabledChanges,
						externalEntries: value.externalEntries,
						formEntries: value.formEntries,
						nativeChanges: value.nativeChanges,
						planChanges: value.planChanges,
						readOnlyChanges: value.readOnlyChanges,
						requiredChanges: value.requiredChanges,
					};
				});

			const plan = page.getByRole("combobox", { exact: true, name: "Plan" });
			expect(await plan.textContent()).toContain("Starter");
			expect(await plan.getAttribute("data-size")).toBe("medium");
			expect(
				await plan.evaluate((element) => getComputedStyle(element).height),
			).toBe("32px");
			expect(
				await plan.evaluate((element) => getComputedStyle(element).fontSize),
			).toBe("13px");
			await plan.click();
			const listbox = page.locator('[role="listbox"]:visible').first();
			const content = page
				.locator('[data-slot="select-content"]:visible')
				.first();
			expect(await listbox.isVisible()).toBe(true);
			const openingMotion = await content.evaluate((element) => ({
				animations: element.getAnimations().length,
				opacity: getComputedStyle(element).opacity,
				scale: getComputedStyle(element).scale,
			}));
			expect(openingMotion.animations).toBeGreaterThan(0);
			await page.waitForTimeout(200);
			expect(
				await content.evaluate((element) => ({
					opacity: getComputedStyle(element).opacity,
					scale: getComputedStyle(element).scale,
				})),
			).toEqual({ opacity: "1", scale: "none" });
			const [planBox, contentBox] = await Promise.all([
				plan.boundingBox(),
				content.boundingBox(),
			]);
			if (!(planBox && contentBox))
				throw new Error("Select geometry unavailable");
			expect(Math.round(contentBox.y - (planBox.y + planBox.height))).toBe(6);
			expect(
				await content.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).not.toBe("0s");
			expect(await listbox.getByRole("option").count()).toBe(3);
			const starterOption = listbox.getByRole("option", {
				exact: true,
				name: "Starter",
			});
			const starterIndicator = starterOption.locator(
				'[data-slot="select-item-indicator"]',
			);
			expect(await starterIndicator.isVisible()).toBe(true);
			const [starterBox, indicatorBox] = await Promise.all([
				starterOption.boundingBox(),
				starterIndicator.boundingBox(),
			]);
			if (!(starterBox && indicatorBox))
				throw new Error("Select indicator geometry unavailable");
			expect(Math.round(indicatorBox.x - starterBox.x)).toBe(8);
			expect(Math.round(indicatorBox.width)).toBe(14);
			expect(Math.round(indicatorBox.height)).toBe(14);
			const starterLabel = await starterOption
				.locator('[data-slot="select-item-copy"]')
				.boundingBox();
			expect(starterLabel?.x ?? 0).toBeGreaterThan(
				indicatorBox.x + indicatorBox.width,
			);
			expect(
				Math.abs(
					indicatorBox.y +
						indicatorBox.height / 2 -
						(starterBox.y + starterBox.height / 2),
				),
			).toBeLessThanOrEqual(1);
			expect(
				await listbox
					.getByRole("option", { name: /Starter/ })
					.evaluate((element) => getComputedStyle(element).height),
			).toBe("32px");
			expect(
				await listbox
					.getByRole("option", { name: /Enterprise/ })
					.getAttribute("data-disabled"),
			).not.toBeNull();
			const team = listbox.getByRole("option", {
				exact: true,
				name: "Team",
			});
			expect(
				await team.locator('[data-slot="select-item-indicator"]').count(),
			).toBe(0);
			expect(await team.textContent()).toContain("For growing teams.");
			expect(await team.textContent()).toContain("Popular");
			const teamDescription = await team.getAttribute("aria-describedby");
			expect(teamDescription).not.toBeNull();
			expect(await page.locator(`#${teamDescription}`).textContent()).toBe(
				"For growing teams.",
			);
			expect(
				await team
					.locator('[data-slot="select-item-metadata"]')
					.getAttribute("aria-hidden"),
			).toBe("true");
			const changesBeforeDisabledPointer = (await fixture()).planChanges.length;
			await listbox
				.getByRole("option", { exact: true, name: "Enterprise" })
				.click({ force: true });
			expect((await fixture()).planChanges.length).toBe(
				changesBeforeDisabledPointer,
			);
			expect(await plan.textContent()).toContain("Starter");
			await team.click();
			await page.waitForTimeout(200);
			expect(await plan.textContent()).toContain("Team");
			expect((await fixture()).planChanges.at(-1)).toEqual({
				source: "mouse",
				value: "team",
			});
			expect(
				await plan.evaluate((element) => element === document.activeElement),
			).toBe(true);
			expect(await listbox.isVisible()).toBe(false);

			await plan.press("Enter");
			expect(await listbox.isVisible()).toBe(true);
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("Escape");
			await page.waitForTimeout(200);
			expect(await listbox.isVisible()).toBe(false);
			expect(
				await plan.evaluate((element) => element === document.activeElement),
			).toBe(true);
			await plan.press("s");
			expect(await plan.textContent()).toContain("Starter");
			await plan.click();
			await page.mouse.click(1200, 650);
			await page.waitForTimeout(200);
			expect(await listbox.isVisible()).toBe(false);

			const controlled = page.getByRole("combobox", {
				name: "Controlled plan",
			});
			await controlled.click();
			await listbox.getByRole("option", { name: /Team/ }).click();
			await page.waitForTimeout(200);
			expect(await controlled.textContent()).toContain("Starter");
			expect((await fixture()).controlledChanges.at(-1)).toEqual({
				source: "mouse",
				value: "team",
			});

			const readOnly = page.getByRole("combobox", { name: "Read-only plan" });
			expect(await readOnly.isEnabled()).toBe(true);
			await readOnly.click();
			expect(await listbox.isVisible()).toBe(true);
			await listbox.getByRole("option", { name: /Team/ }).click();
			expect((await fixture()).readOnlyChanges).toEqual([]);
			expect(await readOnly.textContent()).toContain("Starter");
			await page.keyboard.press("Escape");

			const disabled = page.getByRole("combobox", { name: "Disabled plan" });
			expect(await disabled.isDisabled()).toBe(true);
			expect(
				await disabled.evaluate((element) => getComputedStyle(element).cursor),
			).toBe("not-allowed");
			const invalid = page.getByRole("combobox", { name: "Invalid plan" });
			expect(await invalid.getAttribute("aria-invalid")).toBe("true");

			const small = page.getByRole("combobox", { name: "Small plan" });
			const large = page.getByRole("combobox", { name: "Large plan" });
			expect(
				await small.evaluate((element) => getComputedStyle(element).height),
			).toBe("26px");
			expect(
				await large.evaluate((element) => getComputedStyle(element).height),
			).toBe("36px");
			expect(
				await small.evaluate((element) => getComputedStyle(element).fontSize),
			).toBe("12px");
			expect(
				await small.evaluate(
					(element) => getComputedStyle(element).paddingInlineStart,
				),
			).toBe("10px");
			expect(
				await large.evaluate((element) => getComputedStyle(element).fontSize),
			).toBe("14px");
			await small.click();
			const compactPopup = page
				.locator('[data-slot="select-content"]:visible')
				.last();
			expect(
				await compactPopup.evaluate((popup) => {
					const list = popup.querySelector('[data-slot="select-list"]');
					const styles = getComputedStyle(popup);
					return (
						popup.clientHeight -
						(list?.clientHeight ?? 0) -
						Number.parseFloat(styles.paddingTop) -
						Number.parseFloat(styles.paddingBottom)
					);
				}),
			).toBe(0);
			expect(
				await page
					.locator('[role="listbox"]:visible')
					.last()
					.getByRole("option", { name: /Starter/ })
					.evaluate((element) => getComputedStyle(element).height),
			).toBe("28px");
			await page.keyboard.press("Escape");
			await large.click();
			expect(
				await page
					.locator('[role="listbox"]:visible')
					.last()
					.getByRole("option", { name: /Starter/ })
					.evaluate((element) => getComputedStyle(element).height),
			).toBe("36px");
			await page.keyboard.press("Escape");

			const overflow = page.getByRole("combobox", { name: "Overflow plan" });
			const overflowValue = overflow.locator('[data-slot="select-value"]');
			expect(
				await overflowValue.evaluate(
					(element) => getComputedStyle(element).textOverflow,
				),
			).toBe("ellipsis");
			expect((await overflow.boundingBox())?.width).toBeLessThanOrEqual(150);

			const noLoop = page.getByRole("combobox", { name: "No-loop plan" });
			await noLoop.click();
			await page.keyboard.press("ArrowDown");
			await page.keyboard.press("Enter");
			expect(await noLoop.textContent()).toContain("Team");

			const keyboard = page.getByRole("combobox", { name: "Keyboard plan" });
			await keyboard.press("Space");
			expect(await listbox.isVisible()).toBe(true);
			await page.keyboard.press("Home");
			await page.keyboard.press("End");
			await page.keyboard.press("Space");
			expect(await keyboard.textContent()).toContain("Team");
			await keyboard.press("Enter");
			await page.keyboard.press("End");
			expect(
				await listbox
					.getByRole("option", { exact: true, name: "Enterprise" })
					.getAttribute("data-highlighted"),
			).toBeNull();
			await page.keyboard.press("Escape");

			const empty = page.getByRole("combobox", { name: "Empty plan" });
			await empty.click();
			expect(await page.getByText("No plans available").isVisible()).toBe(true);
			expect(await listbox.getByRole("option").count()).toBe(0);
			await page.keyboard.press("Escape");

			const longList = page.getByRole("combobox", { name: "Long list" });
			await longList.click();
			const longListbox = page.locator('[role="listbox"]:visible').last();
			const longListGeometry = await longListbox.evaluate((element) => ({
				clientHeight: element.clientHeight,
				scrollHeight: element.scrollHeight,
			}));
			expect(longListGeometry.clientHeight).toBeLessThanOrEqual(370);
			expect(longListGeometry.scrollHeight).toBeGreaterThan(
				longListGeometry.clientHeight,
			);
			const firstLongOption = longListbox.getByRole("option", {
				exact: true,
				name: "Option 1",
			});
			expect(
				await firstLongOption
					.locator('[data-slot="select-item-description"]')
					.evaluate((element) => getComputedStyle(element).overflowWrap),
			).toBe("anywhere");
			expect(
				await firstLongOption
					.locator('[data-slot="select-item-metadata"]')
					.evaluate((element) => getComputedStyle(element).textOverflow),
			).toBe("ellipsis");
			const scrollDown = page.getByRole("button", {
				name: "Scroll options down",
			});
			expect(await scrollDown.isVisible()).toBe(true);
			await scrollDown.click();
			expect(
				await longListbox.evaluate((element) => element.scrollTop),
			).toBeGreaterThan(0);
			await page.waitForTimeout(50);
			expect(
				await page
					.getByRole("button", { name: "Scroll options up" })
					.isVisible(),
			).toBe(true);
			await page.keyboard.press("Escape");

			await page.getByRole("button", { name: "Submit external" }).click();
			expect((await fixture()).externalEntries).toEqual([
				["empty-native-plan", ""],
				["external-plan", "outside"],
			]);
			await page.getByRole("button", { exact: true, name: "Submit" }).click();
			expect((await fixture()).formEntries).toEqual([]);

			const required = page.getByRole("combobox", { name: "Required plan" });
			expect(await required.getAttribute("aria-required")).toBe("true");
			await required.click();
			await listbox.getByRole("option", { name: /Team/ }).click();
			const requiredNative = page.getByRole("combobox", {
				exact: true,
				name: "Required native plan",
			});
			expect(await requiredNative.getAttribute("aria-invalid")).toBe("true");
			expect(await requiredNative.getAttribute("required")).not.toBeNull();
			await requiredNative.selectOption("team");
			expect(
				await page
					.getByRole("combobox", {
						exact: true,
						name: "Disabled native plan",
					})
					.isDisabled(),
			).toBe(true);
			await page.getByRole("button", { exact: true, name: "Submit" }).click();
			expect((await fixture()).formEntries).toEqual([
				["plan", "starter"],
				["readonly-plan", "starter"],
				["required-plan", "team"],
				["native-plan", "starter"],
				["required-native-plan", "team"],
			]);
			await page.getByRole("button", { name: "Reset" }).click();
			await page.waitForTimeout(200);
			expect(await required.textContent()).toContain("Choose required");

			const native = page.getByRole("combobox", {
				exact: true,
				name: "Native plan",
			});
			expect(await native.inputValue()).toBe("starter");
			expect(
				await page
					.getByRole("combobox", {
						exact: true,
						name: "Empty native plan",
					})
					.inputValue(),
			).toBe("");
			await native.selectOption("team");
			expect((await fixture()).nativeChanges.at(-1)).toEqual({
				source: "programmatic",
				value: "team",
			});
			await page.getByRole("button", { name: "Reset" }).click();
			await page.waitForTimeout(200);
			expect(await native.inputValue()).toBe("starter");

			const memberRole = page.getByRole("combobox", { name: "Member role" });
			await memberRole.click();
			const humanOnly = await page.evaluate(async () => {
				const fixture = window as unknown as SelectFixtureWindow;
				const exposed = fixture.agent
					.snapshot()
					.some(
						({ label }) =>
							label === "Member role" || label === "Approve appeal",
					);
				const changeRole = await fixture.agent.act({
					steps: [
						{ action: "setValue", args: ["manager"], ref: "Member role" },
					],
				});
				const approve = await fixture.agent.act({
					steps: [{ action: "press", args: [], ref: "Approve appeal" }],
				});
				return [exposed, changeRole.ok, approve.ok];
			});
			expect(humanOnly).toEqual([false, false, false]);
			const humanOnlyChanges = () =>
				page.evaluate(
					() => (window as unknown as SelectFixtureWindow).humanOnlyChanges,
				);
			expect(await humanOnlyChanges()).toEqual([]);
			await page.getByRole("option", { name: "Manager" }).click();
			await page.getByRole("button", { name: "Approve appeal" }).press("Enter");
			expect(await humanOnlyChanges()).toEqual(["manager", "approved"]);

			const agentResults = await page.evaluate(async () => {
				const value = window as unknown as SelectFixtureWindow;
				const components = value.agent.snapshot();
				const byLabel = (label: string) =>
					components.find(
						(component) =>
							component.component === "select" && component.label === label,
					);
				const plan = byLabel("Plan");
				const controlled = byLabel("Controlled plan");
				const readOnly = byLabel("Read-only plan");
				const disabled = byLabel("Disabled plan");
				if (!(plan && controlled && readOnly && disabled))
					throw new Error("Selects were not exposed to the agent");
				const before = plan.value;
				const results = [];
				results.push(
					await value.agent.act({
						steps: [{ action: "setOpen", args: [true], ref: plan.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "setQuery", args: ["team"], ref: plan.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "setValue", args: ["team"], ref: plan.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "clear", args: [], ref: plan.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "setValue", args: ["team"], ref: plan.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [
							{ action: "setValue", args: ["team"], ref: controlled.ref },
						],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "setValue", args: ["unknown"], ref: plan.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [
							{ action: "setValue", args: ["enterprise"], ref: plan.ref },
						],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "setValue", args: ["team"], ref: readOnly.ref }],
					}),
				);
				results.push(
					await value.agent.act({
						steps: [{ action: "setValue", args: ["team"], ref: disabled.ref }],
					}),
				);
				const after = value.agent
					.snapshot()
					.find((component) => component.ref === plan.ref)?.value;
				return { actions: plan.actions, after, before, results };
			});
			expect(agentResults.actions).toEqual([
				"setOpen",
				"setValue",
				"clear",
				"setQuery",
			]);
			expect(agentResults.results.map((result) => result.ok)).toEqual([
				true,
				true,
				true,
				true,
				true,
				true,
				false,
				false,
				false,
				false,
			]);
			expect({
				after: agentResults.after,
				before: agentResults.before,
			}).toEqual({
				after: "team",
				before: "starter",
			});
			expect((await fixture()).planChanges.at(-1)).toEqual({
				source: "agent",
				value: "team",
			});
			await page.keyboard.press("Escape");
			await page.waitForTimeout(200);

			await page.evaluate(() => {
				document.documentElement.setAttribute("data-theme", "dark");
			});
			await page.waitForTimeout(200);
			const darkSurface = await plan.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			await plan.click();
			await page.waitForTimeout(200);
			const darkPopup = await page
				.locator('[data-slot="select-content"]:visible')
				.evaluate((element) => getComputedStyle(element).backgroundColor);
			const darkRowColor = await page
				.locator('[role="option"]:visible')
				.first()
				.evaluate((element) => getComputedStyle(element).color);
			await page.keyboard.press("Escape");
			await page.evaluate(() => {
				document.documentElement.setAttribute("data-theme", "light");
			});
			await page.waitForTimeout(200);
			const lightSurface = await plan.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			await plan.click();
			await page.waitForTimeout(200);
			const lightPopup = await page
				.locator('[data-slot="select-content"]:visible')
				.evaluate((element) => getComputedStyle(element).backgroundColor);
			const lightRowColor = await page
				.locator('[role="option"]:visible')
				.first()
				.evaluate((element) => getComputedStyle(element).color);
			await page.keyboard.press("Escape");
			expect(darkSurface).not.toBe(lightSurface);
			expect(darkPopup).not.toBe(lightPopup);
			expect(darkRowColor).not.toBe(lightRowColor);

			await page.emulateMedia({ reducedMotion: "reduce" });
			await plan.click();
			expect(
				await page
					.locator('[data-slot="select-content"]:visible')
					.evaluate((element) => getComputedStyle(element).transitionDuration),
			).toBe("0s");
			await page.keyboard.press("Escape");

			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "no-preference",
			});
			expect(
				await plan.evaluate((element) => getComputedStyle(element).borderColor),
			).not.toBe("rgba(0, 0, 0, 0)");
			expect(
				await plan.evaluate((element) => getComputedStyle(element).borderWidth),
			).toBe("1px");
			await plan.click();
			const forcedContent = page.locator(
				'[data-slot="select-content"]:visible',
			);
			expect(
				await forcedContent.evaluate(
					(element) => getComputedStyle(element).borderWidth,
				),
			).toBe("1px");
			expect(
				await forcedContent
					.getByRole("option", { exact: true, name: "Team" })
					.locator('[data-slot="select-item-indicator"]')
					.evaluate((element) => getComputedStyle(element).color),
			).not.toBe("rgba(0, 0, 0, 0)");
			await page.keyboard.press("Home");
			const forcedHighlight = forcedContent.locator(
				'[role="option"][data-highlighted]',
			);
			expect(await forcedHighlight.count()).toBe(1);
			const forcedHighlightColors = await forcedHighlight.evaluate(
				(element) => ({
					color: getComputedStyle(element).color,
					forcedColorAdjust: getComputedStyle(element).forcedColorAdjust,
				}),
			);
			expect(forcedHighlightColors.color).not.toBe("rgba(0, 0, 0, 0)");
			expect(forcedHighlightColors.forcedColorAdjust).toBe("none");
			const forcedHighlightRule = await page.evaluate(() => {
				const visit = (rules: CSSRuleList): CSSStyleRule | null => {
					for (const rule of rules) {
						if (
							rule instanceof CSSStyleRule &&
							rule.selectorText ===
								'[data-slot="select-item"][data-highlighted]' &&
							rule.style.background.toLowerCase() === "highlight"
						)
							return rule;
						if ("cssRules" in rule) {
							const nested = visit((rule as CSSGroupingRule).cssRules);
							if (nested) return nested;
						}
					}
					return null;
				};
				for (const sheet of document.styleSheets) {
					const match = visit(sheet.cssRules);
					if (match)
						return {
							background: match.style.background,
							color: match.style.color,
						};
				}
				return null;
			});
			expect(forcedHighlightRule).toEqual(
				expect.objectContaining({
					background: "highlight",
					color: "highlighttext",
				}),
			);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 10_000);
