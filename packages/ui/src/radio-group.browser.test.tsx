import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface RadioFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	controlledChanges: Array<{ source: string; value: string | null }>;
	disabledChanges: Array<{ source: string; value: string | null }>;
	externalEntries: Array<[string, FormDataEntryValue]>;
	formEntries: Array<[string, FormDataEntryValue]>;
	multipleChanges: Array<{ source: string; value: readonly string[] }>;
	planChanges: Array<{ source: string; value: string | null }>;
	readOnlyChanges: Array<{ source: string; value: string | null }>;
	requiredChanges: Array<{ source: string; value: string | null }>;
	viewChanges: Array<{ source: string; value: string | null }>;
}

test("radio groups own selection, forms, segmented motion, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-radio-group-"));
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
			import { ChartLine, TableView } from ${JSON.stringify(fileURLToPath(new URL("./icon.tsx", import.meta.url)))};
			import { createAgent } from ${JSON.stringify(join(root, "node_modules/@ui-sdk/react/dist/agent.js"))};
			import { createElement, Fragment, useState } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { RadioGroup, SegmentedControl } from ${JSON.stringify(fileURLToPath(new URL("./radio-group.tsx", import.meta.url)))};

			window.controlledChanges = [];
			window.disabledChanges = [];
			window.externalEntries = [];
			window.formEntries = [];
			window.multipleChanges = [];
			window.planChanges = [];
			window.readOnlyChanges = [];
			window.requiredChanges = [];
			window.viewChanges = [];
			window.agent = createAgent({ allow: () => true });

			function DynamicSegment() {
				const [expanded, setExpanded] = useState(false);
				return createElement(Fragment, null,
					createElement(SegmentedControl, {
						ariaLabel: "Dynamic view",
						value: expanded ? "inserted" : "beta",
						options: expanded
							? [
								{ label: "Inserted option", value: "inserted" },
								{ label: "Alpha", value: "alpha" },
							]
							: [
								{ label: "Alpha", value: "alpha" },
								{ label: "Beta", value: "beta" },
							],
					}),
					createElement("button", { onClick: () => setExpanded(true), type: "button" }, "Insert option"),
				);
			}

			function StableCountSegment() {
				const [count, setCount] = useState(1000);
				return createElement(Fragment, null,
					createElement(SegmentedControl, {
						ariaLabel: "Count view",
						countMax: 1000,
						defaultValue: "open",
						options: [
							{ count, label: "Open", value: "open" },
							{ count: 2, label: "Closed", value: "closed" },
						],
					}),
					createElement("button", { onClick: () => setCount(1), type: "button" }, "Lower count"),
				);
			}

			function GrowingCountSegment() {
				const [count, setCount] = useState(99);
				return createElement(Fragment, null,
					createElement(SegmentedControl, {
						ariaLabel: "Growing count view",
						defaultValue: "open",
						options: [
							{ count, label: "Open", value: "open" },
							{ count: 2, label: "Closed", value: "closed" },
						],
					}),
					createElement("button", { onClick: () => setCount(100), type: "button" }, "Grow count"),
					createElement("button", { onClick: () => setCount(1), type: "button" }, "Shrink count"),
				);
			}

			createRoot(document.getElementById("root")).render(createElement(
				Fragment,
				null,
				createElement("form", {
					id: "external-form",
					onSubmit: (event) => {
						event.preventDefault();
						window.externalEntries = [...new FormData(event.currentTarget).entries()];
					},
				}, createElement("button", { type: "submit" }, "Submit external")),
				createElement(RadioGroup, {
					ariaLabel: "External plan",
					defaultValue: "outside",
					form: "external-form",
					name: "external-plan",
					options: [{ label: "Outside", value: "outside" }],
				}),
				createElement("form", {
					"data-main-form": "",
					onSubmit: (event) => {
						event.preventDefault();
						window.formEntries = [...new FormData(event.currentTarget).entries()];
					},
				},
				createElement(RadioGroup, {
					ariaLabel: "Plan",
					defaultValue: "starter",
					name: "plan",
					onValueChange: (value, details) => window.planChanges.push({ source: details.source, value }),
					options: [
						{ label: "Starter", value: "starter" },
						{ count: 4, description: "For growing teams.", label: "Team", value: "team" },
						{ disabled: true, label: "Enterprise", value: "enterprise" },
					],
				}),
				createElement(RadioGroup, {
					ariaLabel: "Controlled plan",
					onValueChange: (value, details) => window.controlledChanges.push({ source: details.source, value }),
					options: [
						{ label: "Controlled A", value: "a" },
						{ label: "Controlled B", value: "b" },
					],
					value: "a",
				}),
				createElement(RadioGroup, {
					ariaLabel: "Read-only plan",
					defaultValue: "locked",
					name: "readonly-plan",
					onValueChange: (value, details) => window.readOnlyChanges.push({ source: details.source, value }),
					options: [
						{ label: "Locked", value: "locked" },
						{ label: "Unlocked", value: "unlocked" },
					],
					readOnly: true,
				}),
				createElement(RadioGroup, {
					ariaLabel: "Disabled plan",
					defaultValue: "disabled",
					disabled: true,
					name: "disabled-plan",
					onValueChange: (value, details) => window.disabledChanges.push({ source: details.source, value }),
					options: [{ label: "Disabled", value: "disabled" }],
				}),
				createElement(RadioGroup, {
					ariaLabel: "No wrap",
					defaultValue: "last",
					loop: false,
					options: [
						{ label: "First stop", value: "first" },
						{ label: "Last stop", value: "last" },
					],
				}),
				createElement(RadioGroup, {
					ariaLabel: "Invalid plan",
					invalid: true,
					options: [{ label: "Invalid", value: "invalid" }],
				}),
				createElement(RadioGroup, {
					ariaLabel: "Required plan",
					name: "required-plan",
					onValueChange: (value, details) => window.requiredChanges.push({ source: details.source, value }),
					options: [
						{ label: "Required A", value: "required-a" },
						{ label: "Required B", value: "required-b" },
					],
					required: true,
				}),
				createElement(SegmentedControl, {
					ariaLabel: "View",
					defaultValue: "grid",
					onValueChange: (value, details) => window.viewChanges.push({ source: details.source, value }),
					options: [
						{ count: 12, description: "Twelve grid items.", label: "Grid", value: "grid" },
						{ badge: "New", label: "List", value: "list" },
					],
				}),
				createElement(SegmentedControl, {
					ariaLabel: "Chart view",
					defaultValue: "chart",
					options: [
						{ icon: ChartLine, iconOnly: true, label: "Chart", value: "chart" },
						{ icon: TableView, iconOnly: true, label: "Table", value: "table" },
					],
					size: "small",
				}),
				createElement(SegmentedControl, {
					ariaLabel: "Formatting",
					defaultValue: ["bold"],
					fill: true,
					multiple: true,
					onValueChange: (value, details) => window.multipleChanges.push({ source: details.source, value }),
					options: [
						{ label: "Bold", value: "bold" },
						{ label: "Italic", value: "italic" },
						{ disabled: true, label: "Underline", value: "underline" },
					],
				}),
				createElement("button", { type: "submit" }, "Submit"),
				createElement("button", { type: "reset" }, "Reset"),
				),
				createElement(DynamicSegment),
				createElement(StableCountSegment),
				createElement(GrowingCountSegment),
				createElement("div", { style: { width: "180px" } },
					createElement(SegmentedControl, {
						ariaLabel: "Overflow view",
						defaultValue: "long",
						fill: true,
						options: [
							{ label: "A deliberately long option label", value: "long" },
							{ label: "Short", value: "short" },
						],
					}),
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
			throw new Error("Radio fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://radio-group.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://radio-group.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://radio-group.test/") {
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
			await page.goto("http://radio-group.test/");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as RadioFixtureWindow;
					return {
						controlledChanges: value.controlledChanges,
						disabledChanges: value.disabledChanges,
						externalEntries: value.externalEntries,
						formEntries: value.formEntries,
						multipleChanges: value.multipleChanges,
						planChanges: value.planChanges,
						readOnlyChanges: value.readOnlyChanges,
						requiredChanges: value.requiredChanges,
						viewChanges: value.viewChanges,
					};
				});

			const plan = page.getByRole("radiogroup", { name: "Plan" });
			expect(
				await plan.getByRole("radio", { name: "Starter" }).isChecked(),
			).toBe(true);
			expect(
				await plan
					.getByRole("radio", { exact: true, name: "Team" })
					.getAttribute("aria-describedby"),
			).not.toBeNull();
			expect(
				await plan
					.getByRole("radio", { exact: true, name: "Team" })
					.evaluate((element) =>
						(element.getAttribute("aria-describedby") ?? "")
							.split(" ")
							.map((id) => document.getElementById(id)?.textContent)
							.join(" "),
					),
			).toContain("For growing teams. 4 items");
			const teamLabel = plan
				.locator('[data-slot="radio-label"]')
				.filter({ hasText: "Team" });
			const teamLabelBounds = await teamLabel.boundingBox();
			if (!teamLabelBounds)
				throw new Error("Team label has no rendered bounds");
			await page.mouse.click(
				teamLabelBounds.x + teamLabelBounds.width / 2,
				teamLabelBounds.y + teamLabelBounds.height / 2,
			);
			expect(await plan.getByRole("radio", { name: "Team" }).isChecked()).toBe(
				true,
			);
			expect((await fixture()).planChanges.at(-1)).toEqual({
				source: "mouse",
				value: "team",
			});
			await plan.getByRole("radio", { name: "Team" }).press("ArrowLeft");
			expect(
				await plan.getByRole("radio", { name: "Starter" }).isChecked(),
			).toBe(true);
			expect((await fixture()).planChanges.at(-1)).toEqual({
				source: "keyboard",
				value: "starter",
			});
			await plan.getByRole("radio", { name: "Starter" }).press("ArrowLeft");
			expect(await plan.getByRole("radio", { name: "Team" }).isChecked()).toBe(
				true,
			);
			expect(
				await plan.getByRole("radio", { name: "Enterprise" }).isDisabled(),
			).toBe(true);

			const controlled = page.getByRole("radiogroup", {
				name: "Controlled plan",
			});
			await controlled.getByRole("radio", { name: "Controlled B" }).click();
			expect((await fixture()).controlledChanges.at(-1)).toEqual({
				source: "mouse",
				value: "b",
			});
			expect(
				await controlled
					.getByRole("radio", { name: "Controlled A" })
					.isChecked(),
			).toBe(true);

			const readOnly = page.getByRole("radiogroup", { name: "Read-only plan" });
			await readOnly
				.getByRole("radio", { exact: true, name: "Unlocked" })
				.click();
			expect((await fixture()).readOnlyChanges).toEqual([]);
			expect(
				await readOnly
					.getByRole("radio", { exact: true, name: "Locked" })
					.isChecked(),
			).toBe(true);
			await readOnly
				.getByRole("radio", { exact: true, name: "Locked" })
				.press("ArrowRight");
			expect((await fixture()).readOnlyChanges).toEqual([]);
			expect(
				await readOnly
					.getByRole("radio", { exact: true, name: "Locked" })
					.isChecked(),
			).toBe(true);
			const disabled = page.getByRole("radiogroup", { name: "Disabled plan" });
			expect(
				await disabled.getByRole("radio", { name: "Disabled" }).isDisabled(),
			).toBe(true);

			const noWrap = page.getByRole("radiogroup", { name: "No wrap" });
			await noWrap
				.getByRole("radio", { name: "Last stop" })
				.press("ArrowRight");
			expect(
				await noWrap.getByRole("radio", { name: "Last stop" }).isChecked(),
			).toBe(true);
			const invalid = page.getByRole("radiogroup", { name: "Invalid plan" });
			expect(await invalid.getAttribute("aria-invalid")).toBe("true");
			expect(
				await invalid
					.getByRole("radio", { name: "Invalid" })
					.evaluate((element) => getComputedStyle(element).borderColor),
			).toBe("rgb(227, 94, 73)");

			const required = page.getByRole("radiogroup", { name: "Required plan" });
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(false);
			await required.getByRole("radio", { name: "Required A" }).click();
			expect(
				await page
					.locator("[data-main-form]")
					.evaluate((form) => (form as HTMLFormElement).checkValidity()),
			).toBe(true);

			const viewGroup = page.getByRole("radiogroup", {
				exact: true,
				name: "View",
			});
			const segmented = viewGroup.locator("xpath=../..");
			const thumb = segmented.locator('[data-slot="segmented-control-thumb"]');
			await page.waitForFunction(() =>
				document
					.querySelector('[aria-label="View"]')
					?.parentElement?.parentElement?.hasAttribute("data-ready"),
			);
			const geometry = await segmented.evaluate((element) => {
				const track = element.getBoundingClientRect();
				const thumb = element
					.querySelector<HTMLElement>('[data-slot="segmented-control-thumb"]')
					?.getBoundingClientRect();
				return {
					height: track.height,
					thumbHeight: thumb?.height,
					thumbLeft: thumb?.left,
				};
			});
			expect(geometry.height).toBe(32);
			expect(geometry.thumbHeight).toBe(26);
			expect(
				await thumb.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0.2s, 0.2s");
			expect(
				await viewGroup
					.getByRole("radio", { exact: true, name: "Grid" })
					.count(),
			).toBe(1);
			expect(
				await viewGroup
					.getByRole("radio", { exact: true, name: "List" })
					.count(),
			).toBe(1);
			await viewGroup.getByRole("radio", { exact: true, name: "List" }).click();
			await page.waitForTimeout(250);
			expect((await fixture()).viewChanges.at(-1)).toEqual({
				source: "mouse",
				value: "list",
			});
			expect((await thumb.boundingBox())?.x).toBeGreaterThan(
				geometry.thumbLeft ?? 0,
			);
			const listRadio = viewGroup.getByRole("radio", {
				exact: true,
				name: "List",
			});
			await listRadio.focus();
			await page.keyboard.press("ArrowLeft");
			const gridRadio = viewGroup.getByRole("radio", {
				exact: true,
				name: "Grid",
			});
			expect(
				await gridRadio
					.locator('xpath=../*[@data-slot="radio-label"]')
					.evaluate((element) => getComputedStyle(element).outlineStyle),
			).toBe("solid");

			const chartView = page.getByRole("radiogroup", {
				exact: true,
				name: "Chart view",
			});
			expect(
				await chartView
					.locator("xpath=../..")
					.evaluate((element) =>
						Math.round(element.getBoundingClientRect().height),
					),
			).toBe(26);
			expect(
				await chartView
					.getByRole("radio", { exact: true, name: "Chart" })
					.count(),
			).toBe(1);
			expect(
				await chartView
					.getByRole("radio", { exact: true, name: "Table" })
					.count(),
			).toBe(1);
			expect(await chartView.locator('[data-slot="icon"]').count()).toBe(2);
			expect(
				await chartView
					.locator('[data-slot="icon"]')
					.first()
					.evaluate((element) =>
						Math.round(element.getBoundingClientRect().width),
					),
			).toBe(12);
			expect(
				await viewGroup
					.locator('[data-slot="radio-label"]')
					.first()
					.evaluate((element) => getComputedStyle(element).fontSize),
			).toBe("13px");
			expect(
				await viewGroup
					.locator('[data-slot="radio-label"]')
					.first()
					.evaluate((element) => getComputedStyle(element).gap),
			).toBe("6px");
			expect(
				await chartView
					.locator('[data-slot="radio-label"]')
					.first()
					.evaluate((element) => getComputedStyle(element).fontSize),
			).toBe("12px");

			const formatting = page.getByRole("group", { name: "Formatting" });
			const formattingRoot = formatting.locator("xpath=..");
			expect(
				await formattingRoot.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBeGreaterThan(500);
			await formatting.getByRole("button", { name: "Italic" }).click();
			expect((await fixture()).multipleChanges.at(-1)).toEqual({
				source: "mouse",
				value: ["bold", "italic"],
			});
			expect(
				await formatting
					.getByRole("button", { name: "Italic" })
					.getAttribute("aria-pressed"),
			).toBe("true");
			expect(
				await formatting
					.getByRole("button", { name: "Underline" })
					.getAttribute("aria-disabled"),
			).toBe("true");

			const dynamic = page.getByRole("radiogroup", {
				exact: true,
				name: "Dynamic view",
			});
			const dynamicThumb = dynamic
				.locator("xpath=../..")
				.locator('[data-slot="segmented-control-thumb"]');
			const dynamicBefore = await dynamicThumb.boundingBox();
			await page.getByRole("button", { name: "Insert option" }).click();
			await page.waitForTimeout(250);
			expect(await dynamic.getByRole("radio").count()).toBe(2);
			expect(
				await dynamic
					.getByRole("radio", { name: "Inserted option" })
					.isChecked(),
			).toBe(true);
			expect((await dynamicThumb.boundingBox())?.x).not.toBe(dynamicBefore?.x);

			const countView = page.getByRole("radiogroup", {
				exact: true,
				name: "Count view",
			});
			const countRoot = countView.locator("xpath=../..");
			const countWidth = await countRoot.evaluate(
				(element) => element.getBoundingClientRect().width,
			);
			expect(
				await countRoot
					.locator('[data-slot="segmented-count-value"]')
					.first()
					.textContent(),
			).toBe("1,000");
			await page.getByRole("button", { name: "Lower count" }).click();
			expect(
				await countRoot.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBe(countWidth);

			const growingCountView = page.getByRole("radiogroup", {
				exact: true,
				name: "Growing count view",
			});
			const growingCountRoot = growingCountView.locator("xpath=../..");
			const growingBefore = await growingCountRoot.evaluate(
				(element) => element.getBoundingClientRect().width,
			);
			await page.getByRole("button", { name: "Grow count" }).click();
			const growingWidth = await growingCountRoot.evaluate(
				(element) => element.getBoundingClientRect().width,
			);
			expect(growingWidth).toBeGreaterThan(growingBefore);
			await page.getByRole("button", { name: "Shrink count" }).click();
			expect(
				await growingCountRoot.evaluate(
					(element) => element.getBoundingClientRect().width,
				),
			).toBe(growingWidth);

			const overflowView = page.getByRole("radiogroup", {
				exact: true,
				name: "Overflow view",
			});
			const overflowRoot = overflowView.locator("xpath=../..");
			expect(
				await overflowRoot.evaluate(
					(element) => getComputedStyle(element).overflow,
				),
			).toBe("hidden");
			expect(
				await overflowView
					.locator('[data-slot="radio-label-text"]')
					.first()
					.evaluate((element) => getComputedStyle(element).textOverflow),
			).toBe("ellipsis");
			expect(
				await overflowView
					.locator('[data-slot="radio-label-text"]')
					.first()
					.getAttribute("title"),
			).toBe("A deliberately long option label");

			const agentResults = await page.evaluate(async () => {
				const value = window as unknown as RadioFixtureWindow;
				const components = value.agent.snapshot();
				const byLabel = (label: string) =>
					components.find((component) => component.label === label);
				const plan = byLabel("Plan");
				const controlled = byLabel("Controlled plan");
				const readOnly = byLabel("Read-only plan");
				const disabled = byLabel("Disabled plan");
				const formatting = byLabel("Formatting");
				if (!(plan && controlled && readOnly && disabled && formatting))
					throw new Error("Radio groups were not exposed to the agent");
				return Promise.all([
					value.agent.act({
						steps: [{ action: "setValue", args: ["starter"], ref: plan.ref }],
					}),
					value.agent.act({
						steps: [{ action: "setValue", args: ["b"], ref: controlled.ref }],
					}),
					value.agent.act({
						steps: [{ action: "setValue", args: ["unknown"], ref: plan.ref }],
					}),
					value.agent.act({
						steps: [
							{
								action: "setValue",
								args: [["italic"]],
								ref: formatting.ref,
							},
						],
					}),
					value.agent.act({
						steps: [
							{ action: "setValue", args: ["unlocked"], ref: readOnly.ref },
						],
					}),
					value.agent.act({
						steps: [
							{ action: "setValue", args: ["disabled"], ref: disabled.ref },
						],
					}),
					value.agent.act({
						steps: [
							{
								action: "setValue",
								args: [["underline"]],
								ref: formatting.ref,
							},
						],
					}),
					value.agent.act({
						steps: [
							{ action: "setValue", args: [["unknown"]], ref: formatting.ref },
						],
					}),
				]);
			});
			expect(agentResults.map((result) => result.ok)).toEqual([
				true,
				true,
				false,
				true,
				false,
				false,
				false,
				false,
			]);
			expect((await fixture()).planChanges.at(-1)).toEqual({
				source: "agent",
				value: "starter",
			});
			expect((await fixture()).controlledChanges.at(-1)).toEqual({
				source: "agent",
				value: "b",
			});
			expect((await fixture()).readOnlyChanges).toEqual([]);
			expect((await fixture()).disabledChanges).toEqual([]);
			expect((await fixture()).multipleChanges.at(-1)).toEqual({
				source: "agent",
				value: ["italic"],
			});
			await page.waitForTimeout(50);

			await page.getByRole("button", { exact: true, name: "Submit" }).click();
			expect((await fixture()).formEntries).toEqual([
				["plan", "starter"],
				["readonly-plan", "locked"],
				["required-plan", "required-a"],
			]);
			await page.getByRole("button", { name: "Submit external" }).click();
			expect((await fixture()).externalEntries).toEqual([
				["external-plan", "outside"],
			]);

			await page.getByRole("button", { name: "Reset" }).click();
			expect(
				await plan.getByRole("radio", { name: "Starter" }).isChecked(),
			).toBe(true);
			expect(
				await required.getByRole("radio", { name: "Required A" }).isChecked(),
			).toBe(false);

			await formatting.getByRole("button", { name: "Bold" }).click();
			expect(
				await formatting
					.getByRole("button", { name: "Bold" })
					.getAttribute("aria-pressed"),
			).toBe("true");
			expect(
				await formatting
					.getByRole("button", { name: "Bold" })
					.getAttribute("data-pressed"),
			).toBe("");
			await listRadio.press("ArrowLeft");
			const renderedState = async () => ({
				selectedContrast: await segmented.evaluate((root) => {
					const label = root.querySelector(
						'[data-slot="radio-option"]:has([data-checked]) [data-slot="radio-label"]',
					);
					const fill = root.querySelector(
						'[data-slot="segmented-control-thumb"]',
					);
					if (!(label && fill)) throw new Error("Missing selected segment");
					const channels = (color: string) =>
						(color.match(/[\d.]+/g) ?? []).map(Number);
					const [r, g, b, alpha = 1] = channels(getComputedStyle(label).color);
					const luminance = (values: number[]) =>
						values.reduce((sum, value, index) => {
							const channel = value / 255;
							const linear =
								channel <= 0.04045
									? channel / 12.92
									: ((channel + 0.055) / 1.055) ** 2.4;
							return sum + linear * ([0.2126, 0.7152, 0.0722][index] ?? 0);
						}, 0);
					const surface = getComputedStyle(fill);
					const stops = [
						surface.backgroundColor,
						...(surface.backgroundImage.match(/rgba?\([^)]*\)/g) ?? []),
					];
					return Math.min(
						...stops.map((stop) => {
							const background = channels(stop).slice(0, 3);
							const bg = luminance(background);
							const fg = luminance(
								background.map(
									(value, index) =>
										alpha * ([r, g, b][index] ?? 0) + (1 - alpha) * value,
								),
							);
							return (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
						}),
					);
				}),
				disabledBackground: await disabled
					.getByRole("radio", { name: "Disabled" })
					.evaluate((element) => getComputedStyle(element).backgroundColor),
				focusOutline: await gridRadio
					.locator('xpath=../*[@data-slot="radio-label"]')
					.evaluate((element) => getComputedStyle(element).outlineStyle),
				invalidBorder: await invalid
					.getByRole("radio", { name: "Invalid" })
					.evaluate((element) => getComputedStyle(element).borderColor),
				multipleFill: await formatting
					.getByRole("button", { name: "Bold" })
					.evaluate((element) => getComputedStyle(element).backgroundImage),
				normalBorder: await controlled
					.getByRole("radio", { name: "Controlled B" })
					.evaluate((element) => getComputedStyle(element).borderColor),
				overflow: await overflowView
					.locator('[data-slot="radio-label-text"]')
					.first()
					.evaluate((element) => getComputedStyle(element).textOverflow),
				readOnlyCursor: await readOnly
					.getByRole("radio", { exact: true, name: "Locked" })
					.evaluate((element) => getComputedStyle(element).cursor),
				surface: await segmented.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			});
			const lightState = await renderedState();
			expect(lightState.selectedContrast).toBeGreaterThanOrEqual(4.5);
			expect(lightState).toMatchObject({
				focusOutline: "solid",
				overflow: "ellipsis",
				readOnlyCursor: "default",
			});
			expect(lightState.invalidBorder).not.toBe(lightState.normalBorder);
			expect(
				lightState.multipleFill,
				await formatting.evaluate((element) => element.outerHTML),
			).toContain("linear-gradient");
			await page
				.locator("#root")
				.evaluate((element) => element.setAttribute("data-theme", "dark"));
			await disabled
				.getByRole("radio", { name: "Disabled" })
				.evaluate(async (node) => {
					await new Promise(requestAnimationFrame);
					await Promise.allSettled(
						node.getAnimations().map((animation) => animation.finished),
					);
				});
			const darkState = await renderedState();
			expect(darkState.selectedContrast).toBeGreaterThanOrEqual(4.5);
			expect(darkState).toMatchObject({
				focusOutline: "solid",
				overflow: "ellipsis",
				readOnlyCursor: "default",
			});
			expect(darkState.invalidBorder).not.toBe(darkState.normalBorder);
			expect(darkState.multipleFill).toContain("linear-gradient");
			expect(darkState.surface).not.toBe(lightState.surface);
			expect(darkState.disabledBackground).not.toBe(
				lightState.disabledBackground,
			);
			expect(
				await thumb.evaluate(
					(element) => getComputedStyle(element).backgroundImage,
				),
			).toContain("linear-gradient");
			expect(
				await thumb.evaluate((element) => getComputedStyle(element).boxShadow),
			).not.toBe("none");
			await page.emulateMedia({ forcedColors: "active" });
			expect(
				await thumb.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await thumb.evaluate(
					(element) => getComputedStyle(element).backgroundImage,
				),
			).toBe("none");
			await page.emulateMedia({ forcedColors: "none" });
			await page.emulateMedia({ reducedMotion: "reduce" });
			expect(
				await thumb.evaluate(
					(element) => getComputedStyle(element).transitionDuration,
				),
			).toBe("0s, 0s");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
