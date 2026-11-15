import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface DisclosureFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; label?: string; ref: string }>;
	};
	accordionChanges: Array<{ source: string; value: string[] }>;
	collapsibleChanges: Array<{ open: boolean; source: string }>;
	controlledAccordionChanges: Array<{ source: string; value: string[] }>;
	controlledCollapsibleChanges: Array<{ open: boolean; source: string }>;
}

test("disclosures share controlled, keyboard, disabled, and agent behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-disclosures-"));
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
			import { createElement } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Accordion, Collapsible } from ${JSON.stringify(fileURLToPath(new URL("./collapsible.tsx", import.meta.url)))};
			import { Search } from ${JSON.stringify(fileURLToPath(new URL("./icon.tsx", import.meta.url)))};

			window.accordionChanges = [];
			window.collapsibleChanges = [];
			window.controlledAccordionChanges = [];
			window.controlledCollapsibleChanges = [];
			window.agent = createAgent({ allow: () => true });
			const items = [
				{ content: "First panel", label: "First", value: "first" },
				{ content: "Locked panel", disabled: true, label: "Locked item", value: "locked" },
				{ content: "Third panel", label: "Third", value: "third" },
			];
			createRoot(document.getElementById("root")).render(createElement(
				"main",
				{ className: "tripwire" },
				createElement(Collapsible, {
					header: {
						content: createElement("span", { id: "header-before-content" }, "Repository access with a deliberately long label"),
						leading: createElement("span", { "aria-hidden": true }, "F"),
						trailing: createElement("span", { "aria-hidden": true }, "3"),
						trigger: "Before toggle",
					},
					triggerTone: "quiet",
				}, "Header details"),
				createElement(Collapsible, {
					header: {
						content: createElement("span", { id: "header-after-content" }, "Audit evidence with a deliberately long label"),
						leading: createElement("span", { "aria-hidden": true }, "A"),
						trailing: createElement("span", { "aria-hidden": true }, "9"),
						trigger: "After toggle",
						triggerPosition: "after-content",
					},
				}, "After details"),
				createElement(Collapsible, {
					onOpenChange: (open, details) => window.collapsibleChanges.push({ open, source: details.source }),
					trigger: "Details",
				}, "Audit details"),
				createElement(Collapsible, {
					closedSummary: "4 of 5",
					trigger: "Where it applies",
					variant: "compact",
				}, "Compact details"),
				createElement(Collapsible, {
					summary: "3 repositories",
					trigger: "Repository access",
				}, "Repository details"),
				createElement(Collapsible, {
					disabled: true,
					trigger: "Locked disclosure",
				}, "Unavailable details"),
				createElement(Collapsible, {
					onOpenChange: (open, details) => window.controlledCollapsibleChanges.push({ open, source: details.source }),
					open: false,
					trigger: "Controlled disclosure",
				}, "Controlled details"),
				createElement(Collapsible, {
					hiddenUntilFound: true,
					onOpenChange: (open, details) => window.collapsibleChanges.push({ open, source: details.source }),
					trigger: "Findable disclosure",
				}, "Findable details"),
				createElement(Collapsible, {
					onOpenChange: (open, details) => window.collapsibleChanges.push({ open, source: details.source }),
					trigger: "Agent disclosure",
				}, "Agent details"),
				createElement(Accordion, {
					defaultValue: ["first"],
					items: items.map((item, index) => index === 0 ? { ...item, count: 1000, panelVariant: "bordered" } : item),
					onValueChange: (value, details) => window.accordionChanges.push({ source: details.source, value }),
				}),
				createElement(Accordion, {
					defaultValue: ["first"],
					items: [items[0], items[2]],
					multiple: true,
					variant: "picker",
				}),
				createElement(Accordion, {
					items: [items[0], items[2]],
					onValueChange: (value, details) => window.controlledAccordionChanges.push({ source: details.source, value }),
					value: ["first"],
				}),
				createElement(Accordion, {
					disabled: true,
					items: [{ content: "Disabled panel", label: "Disabled accordion", value: "disabled" }],
				}),
				createElement("div", { id: "narrow-accordion", style: { inlineSize: "180px" } }, createElement(Accordion, {
					items: [{ content: "Narrow panel", count: 9999999, label: "A deliberately long accordion label that must truncate", value: "narrow" }],
				})),
				createElement("div", { id: "section-accordion", style: { inlineSize: "180px" } }, createElement(Accordion, {
					items: [{ content: "Section choices", icon: Search, label: "Expandable section", value: "section" }],
					variant: "sections",
				})),
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
			throw new Error("Disclosure browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext();
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://disclosures.test/client.js") {
					await route.fulfill({ body: bundle, contentType: "text/javascript" });
					return;
				}
				if (url === "http://disclosures.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://disclosures.test/") {
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
			await page.goto("http://disclosures.test/");
			const fixture = () =>
				page.evaluate(() => {
					const value = window as unknown as DisclosureFixtureWindow;
					return {
						accordionChanges: value.accordionChanges,
						collapsibleChanges: value.collapsibleChanges,
						controlledAccordionChanges: value.controlledAccordionChanges,
						controlledCollapsibleChanges: value.controlledCollapsibleChanges,
					};
				});

			const details = page.getByRole("button", { name: "Details" });
			const headerBefore = page.getByRole("button", { name: "Before toggle" });
			const headerAfter = page.getByRole("button", { name: "After toggle" });
			const headerBeforeSummary = headerBefore.locator("..");
			const headerAfterSummary = headerAfter.locator("..");
			await headerBeforeSummary.evaluate((element) => {
				(element as HTMLElement).style.inlineSize = "240px";
			});
			await headerAfterSummary.evaluate((element) => {
				(element as HTMLElement).style.inlineSize = "240px";
			});
			const headerBeforeBox = await headerBefore.boundingBox();
			const headerAfterBox = await headerAfter.boundingBox();
			const headerBeforeSummaryBox = await headerBeforeSummary.boundingBox();
			const headerAfterSummaryBox = await headerAfterSummary.boundingBox();
			expect(headerBeforeBox?.width).toBeLessThan(120);
			expect(headerAfterBox?.width).toBeLessThan(120);
			expect(headerBeforeSummaryBox?.width).toBe(240);
			expect(headerAfterSummaryBox?.width).toBe(240);
			expect(headerBeforeBox?.x).toBeLessThan(
				(await page.locator("#header-before-content").boundingBox())?.x ?? 0,
			);
			expect(headerAfterBox?.x).toBeGreaterThan(
				(await page.locator("#header-after-content").boundingBox())?.x ?? 0,
			);
			expect(
				await page.locator("#header-before-content").evaluate((element) => ({
					clientWidth: element.parentElement?.clientWidth ?? 0,
					scrollWidth: element.parentElement?.scrollWidth ?? 0,
				})),
			).toEqual(expect.objectContaining({ clientWidth: expect.any(Number) }));
			expect(
				await headerBefore.evaluate(
					(element) => getComputedStyle(element).fontSize,
				),
			).toBe("12px");
			const summary = page.locator('[data-slot="collapsible-summary"]').filter({
				has: page.getByRole("button", { name: "Repository access" }),
			});
			expect(
				await summary
					.locator('[data-slot="collapsible-summary-content"]')
					.textContent(),
			).toBe("3 repositories");
			const compact = page.locator(
				'[data-slot="collapsible"][data-variant="compact"]',
			);
			const compactTrigger = compact.getByRole("button");
			const compactCaret = compact.locator('[data-slot="collapsible-caret"]');
			expect(await compactTrigger.boundingBox()).toMatchObject({ height: 26 });
			expect(
				await compact.evaluate(
					(element) => getComputedStyle(element).borderBottomWidth,
				),
			).toBe("0px");
			expect(await compactTrigger.getAttribute("aria-expanded")).toBe("false");
			expect(await compactTrigger.innerText()).toContain("4 of 5");
			await compactTrigger.press("Enter");
			expect(await compactTrigger.getAttribute("aria-expanded")).toBe("true");
			const caretElement = await compactCaret.elementHandle();
			await page.waitForFunction(
				(element) => element && getComputedStyle(element).rotate === "90deg",
				caretElement,
			);
			expect(await compactTrigger.innerText()).toBe("Where it applies");
			expect(
				await compact
					.locator('[data-slot="collapsible-panel"]')
					.evaluate((element) => getComputedStyle(element).padding),
			).toBe("0px");
			await compactTrigger.press("Space");
			expect(await compactTrigger.getAttribute("aria-expanded")).toBe("false");
			expect(await compactTrigger.innerText()).toContain("4 of 5");
			expect(await details.boundingBox()).toMatchObject({ height: 36 });
			await details.focus();
			expect(
				await details.evaluate(
					(element) => getComputedStyle(element).outlineStyle,
				),
			).toBe("solid");
			expect(await details.getAttribute("aria-expanded")).toBe("false");
			await details.click();
			expect(await details.getAttribute("aria-expanded")).toBe("true");
			const detailsPanel = page.getByText("Audit details");
			expect(
				await detailsPanel.evaluate(
					(element) => getComputedStyle(element).borderWidth,
				),
			).toBe("0px");
			expect(
				Number.parseFloat(
					await detailsPanel.evaluate(
						(element) => getComputedStyle(element).transitionDuration,
					),
				),
			).toBeGreaterThan(0);
			expect((await fixture()).collapsibleChanges.at(-1)).toEqual({
				open: true,
				source: "mouse",
			});
			await details.press("Space");
			expect(await details.getAttribute("aria-expanded")).toBe("false");
			expect((await fixture()).collapsibleChanges.at(-1)).toEqual({
				open: false,
				source: "keyboard",
			});

			const lockedDisclosure = page.getByRole("button", {
				name: "Locked disclosure",
			});
			await lockedDisclosure.focus();
			expect(await lockedDisclosure.getAttribute("aria-disabled")).toBe("true");
			await lockedDisclosure.press("Enter");
			expect(await lockedDisclosure.getAttribute("aria-expanded")).toBe(
				"false",
			);

			const controlledDisclosure = page.getByRole("button", {
				name: "Controlled disclosure",
			});
			await controlledDisclosure.click();
			expect(await controlledDisclosure.getAttribute("aria-expanded")).toBe(
				"false",
			);
			expect((await fixture()).controlledCollapsibleChanges.at(-1)).toEqual({
				open: true,
				source: "mouse",
			});

			const findablePanel = page.getByText("Findable details");
			expect(await findablePanel.getAttribute("hidden")).toBe("until-found");
			await findablePanel.dispatchEvent("beforematch");
			await page.waitForFunction(
				() =>
					document.querySelector(
						'[data-slot="collapsible-trigger"][aria-expanded="true"]',
					)?.textContent === "Findable disclosure",
			);
			expect(await findablePanel.getAttribute("hidden")).toBeNull();
			expect(
				await page
					.getByRole("button", { name: "Findable disclosure" })
					.getAttribute("aria-expanded"),
			).toBe("true");
			expect((await fixture()).collapsibleChanges.at(-1)).toEqual({
				open: true,
				source: "programmatic",
			});

			const accordion = page.locator('[data-slot="accordion"]').nth(0);
			const first = accordion.getByRole("button", { name: "First" });
			const lockedItem = accordion.getByRole("button", { name: "Locked item" });
			const third = accordion.getByRole("button", { name: "Third" });
			expect(await first.getAttribute("aria-expanded")).toBe("true");
			expect(await first.textContent()).toContain("1,000");
			const firstPanel = accordion.getByText("First panel");
			expect(
				await firstPanel.evaluate(
					(element) => getComputedStyle(element).borderStyle,
				),
			).toBe("solid");
			const lightPanelBorder = await firstPanel.evaluate(
				(element) => getComputedStyle(element).borderColor,
			);
			await third.focus();
			await third.press("Enter");
			expect(await first.getAttribute("aria-expanded")).toBe("false");
			expect(await third.getAttribute("aria-expanded")).toBe("true");
			expect((await fixture()).accordionChanges.at(-1)).toEqual({
				source: "keyboard",
				value: ["third"],
			});
			await lockedItem.focus();
			await lockedItem.press("Enter");
			expect(await lockedItem.getAttribute("aria-expanded")).toBe("false");
			await third.focus();
			for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
				await third.press(key);
				expect(
					await third.evaluate((element) => element === document.activeElement),
				).toBe(true);
			}
			await first.focus();
			await first.press("Tab");
			expect(
				await lockedItem.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await lockedItem.press("Tab");
			expect(
				await third.evaluate((element) => element === document.activeElement),
			).toBe(true);

			const multiple = page.locator('[data-slot="accordion"]').nth(1);
			await multiple.getByRole("button", { name: "Third" }).click();
			expect(
				await multiple
					.getByRole("button", { name: "First" })
					.getAttribute("aria-expanded"),
			).toBe("true");
			expect(
				await multiple
					.getByRole("button", { name: "Third" })
					.getAttribute("aria-expanded"),
			).toBe("true");

			const controlledAccordion = page
				.locator('[data-slot="accordion"]')
				.nth(2);
			await controlledAccordion.getByRole("button", { name: "Third" }).click();
			expect(
				await controlledAccordion
					.getByRole("button", { name: "First" })
					.getAttribute("aria-expanded"),
			).toBe("true");
			expect(
				await controlledAccordion
					.getByRole("button", { name: "Third" })
					.getAttribute("aria-expanded"),
			).toBe("false");
			expect((await fixture()).controlledAccordionChanges.at(-1)).toEqual({
				source: "mouse",
				value: ["third"],
			});
			const disabledAccordion = page.locator('[data-slot="accordion"]').nth(3);
			const disabledAccordionTrigger = disabledAccordion.getByRole("button", {
				name: "Disabled accordion",
			});
			expect(await disabledAccordionTrigger.getAttribute("aria-disabled")).toBe(
				"true",
			);
			await disabledAccordionTrigger.press("Enter");
			expect(await disabledAccordionTrigger.getAttribute("aria-expanded")).toBe(
				"false",
			);
			const narrowAccordion = page.locator("#narrow-accordion");
			const narrowTrigger = narrowAccordion.getByRole("button");
			const narrowLabel = narrowTrigger.locator(
				'[data-slot="accordion-label"]',
			);
			expect(await narrowTrigger.textContent()).toContain("9,999,999");
			expect(
				await narrowAccordion.evaluate(
					(element) => element.scrollWidth <= element.clientWidth,
				),
			).toBe(true);
			expect(
				await narrowLabel.evaluate(
					(element) => element.scrollWidth > element.clientWidth,
				),
			).toBe(true);
			const pickerTrigger = multiple.getByRole("button", { name: "First" });
			expect(await pickerTrigger.boundingBox()).toMatchObject({ height: 26 });
			expect(
				await pickerTrigger.evaluate(
					(element) => getComputedStyle(element).fontSize,
				),
			).toBe("12px");

			const section = page.locator("#section-accordion");
			const sectionTrigger = section.getByRole("button", {
				exact: true,
				name: "Expandable section",
			});
			const sectionChevron = section.locator('[data-slot="accordion-chevron"]');
			await page.emulateMedia({ reducedMotion: "reduce" });
			expect(await sectionTrigger.boundingBox()).toMatchObject({ height: 32 });
			expect(await sectionTrigger.getAttribute("aria-expanded")).toBe("false");
			await sectionTrigger.press("Space");
			expect(await sectionTrigger.getAttribute("aria-expanded")).toBe("true");
			await section.getByText("Section choices").waitFor({ state: "visible" });
			expect(
				await sectionChevron.evaluate(
					(element) => getComputedStyle(element).rotate,
				),
			).toBe("180deg");
			await page.emulateMedia({ reducedMotion: "no-preference" });

			const agentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as DisclosureFixtureWindow;
				const components = fixtureWindow.agent.snapshot();
				const disclosure = components.find(
					(component) => component.label === "Agent disclosure",
				);
				const lockedDisclosure = components.find(
					(component) => component.label === "Locked disclosure",
				);
				const accordions = components.filter(
					(component) => component.component === "accordion",
				);
				const accordion = accordions[0];
				const controlledAccordion = accordions[2];
				const disabledAccordion = accordions[3];
				if (
					!disclosure ||
					!lockedDisclosure ||
					!accordion ||
					!controlledAccordion ||
					!disabledAccordion
				) {
					throw new Error(JSON.stringify(components));
				}
				return Promise.all([
					fixtureWindow.agent.act({
						steps: [{ action: "setOpen", args: [true], ref: disclosure.ref }],
					}),
					fixtureWindow.agent.act({
						steps: [{ action: "open", args: ["first"], ref: accordion.ref }],
					}),
					fixtureWindow.agent.act({
						steps: [
							{ action: "setOpen", args: [true], ref: lockedDisclosure.ref },
						],
					}),
					fixtureWindow.agent.act({
						steps: [{ action: "open", args: ["locked"], ref: accordion.ref }],
					}),
					fixtureWindow.agent.act({
						steps: [
							{ action: "open", args: ["third"], ref: controlledAccordion.ref },
						],
					}),
					fixtureWindow.agent.act({
						steps: [
							{
								action: "open",
								args: ["disabled"],
								ref: disabledAccordion.ref,
							},
						],
					}),
				]);
			});
			expect(agentResults.map((result) => result.ok)).toEqual([
				true,
				true,
				false,
				false,
				true,
				false,
			]);
			expect(
				await page
					.getByRole("button", { name: "Agent disclosure" })
					.getAttribute("aria-expanded"),
			).toBe("true");
			expect((await fixture()).collapsibleChanges.at(-1)).toEqual({
				open: true,
				source: "agent",
			});
			expect((await fixture()).accordionChanges.at(-1)).toEqual({
				source: "agent",
				value: ["first"],
			});
			expect((await fixture()).controlledAccordionChanges.at(-1)).toEqual({
				source: "agent",
				value: ["third"],
			});
			expect(
				await controlledAccordion
					.getByRole("button", { name: "First" })
					.getAttribute("aria-expanded"),
			).toBe("true");

			const lightTriggerColor = await details.evaluate(
				(element) => getComputedStyle(element).color,
			);
			await details.hover();
			const lightHoverBackground = await details.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			const lightDisabledColor = await lockedDisclosure.evaluate(
				(element) => getComputedStyle(element).color,
			);
			const firstCount = first.locator('[data-slot="accordion-count"]');
			const lightCountColor = await firstCount.evaluate(
				(element) => getComputedStyle(element).color,
			);
			await page
				.locator("main.tripwire")
				.evaluate((element) => element.setAttribute("data-theme", "dark"));
			await page.waitForTimeout(50);
			expect(
				await firstPanel.evaluate(
					(element) => getComputedStyle(element).borderColor,
				),
			).not.toBe(lightPanelBorder);
			expect(
				await details.evaluate((element) => getComputedStyle(element).color),
			).not.toBe(lightTriggerColor);
			await details.hover();
			expect(
				await details.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).not.toBe(lightHoverBackground);
			expect(
				await lockedDisclosure.evaluate(
					(element) => getComputedStyle(element).color,
				),
			).not.toBe(lightDisabledColor);
			expect(
				await firstCount.evaluate((element) => getComputedStyle(element).color),
			).not.toBe(lightCountColor);

			await page.emulateMedia({ reducedMotion: "reduce" });
			await details.click();
			expect(
				Number.parseFloat(
					await detailsPanel.evaluate(
						(element) => getComputedStyle(element).transitionDuration,
					),
				),
			).toBe(0);

			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "no-preference",
			});
			expect(
				await details.evaluate(
					(element) => getComputedStyle(element).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await firstPanel.evaluate(
					(element) => getComputedStyle(element).borderStyle,
				),
			).toBe("solid");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
