import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

interface DialogFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: unknown[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{
			actions?: string[];
			component: string;
			confirm?: string;
			label?: string;
			ref: string;
		}>;
	};
	actionCount: number;
	actionSources: string[];
	allowDestructive: boolean;
	confirmCount: number;
	confirmSources: string[];
	confirmations: string[];
	controlledActionCount: number;
	controlledActionSources: string[];
	controlledChanges: boolean[];
	controlledChangeSources: string[];
	destructiveCount: number;
	destructiveSources: string[];
	destructiveChangeSources: string[];
	regularChanges: Array<{ open: boolean; source: string }>;
	resolveAction: () => void;
	resolveDestructive: () => void;
}

test("dialog owns focus, dismissal, return, and pending action behavior", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-dialog-"));
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
			import { AgentBoundary } from ${JSON.stringify(fileURLToPath(new URL("./agent-policy.tsx", import.meta.url)))};
			import { AlertDialog, DestructiveDialog, Dialog } from ${JSON.stringify(fileURLToPath(new URL("./dialog.tsx", import.meta.url)))};

			window.actionCount = 0;
			window.actionSources = [];
			window.allowDestructive = false;
			window.confirmCount = 0;
			window.confirmSources = [];
			window.confirmations = [];
			window.controlledActionCount = 0;
			window.controlledActionSources = [];
			window.controlledChanges = [];
			window.controlledChangeSources = [];
			window.destructiveCount = 0;
			window.destructiveSources = [];
			window.destructiveChangeSources = [];
			window.regularChanges = [];
			window.resolveAction = () => undefined;
			window.resolveDestructive = () => undefined;
			window.agent = createAgent({ allow: (action) => {
				if (!action.confirm) return true;
				window.confirmations.push(action.confirm);
				return window.allowDestructive;
			} });
			const save = (details) => {
				window.actionCount += 1;
				window.actionSources.push(details.source);
				return new Promise((resolve) => {
					window.resolveAction = resolve;
				});
			};
			function ControlledDialogFixture() {
				const [open, setOpen] = useState(false);
				return createElement(Dialog, {
					action: {
						label: "Apply",
							onAction: (details) => {
								window.controlledActionCount += 1;
								window.controlledActionSources.push(details.source);
							},
					},
					onOpenChange: (next, details) => {
						window.controlledChanges.push(next);
						window.controlledChangeSources.push(details.source);
						setOpen(next);
					},
					open,
					title: "Controlled workspace",
					trigger: createElement("button", { type: "button" }, "Open controlled dialog"),
				}, createElement("p", null, "Controlled body"));
			}
			function MultiStepDialogFixture() {
				const [reviewed, setReviewed] = useState(false);
				return createElement(Dialog, {
					action: {
						dismissOnSuccess: false,
						label: "Continue to review",
						onAction: () => setReviewed(true),
					},
					title: "Review a change",
					trigger: createElement("button", { type: "button" }, "Open review dialog"),
				}, createElement("p", null, reviewed ? "Ready to confirm" : "Check the details"));
			}
			function FailingDialogFixture() {
				let attempts = 0;
				return createElement(Dialog, {
					action: {
						label: "Publish",
						onAction: async () => {
							attempts += 1;
							if (attempts === 1) throw new Error("Publishing is temporarily unavailable.");
						},
					},
					title: "Publish changes",
					trigger: createElement("button", { type: "button" }, "Open publish dialog"),
				}, createElement("p", null, "Review your changes."));
			}
			function DestructiveDialogFixture() {
				const [open, setOpen] = useState(false);
				const [failureOpen, setFailureOpen] = useState(false);
				return createElement(Fragment, null,
					createElement(DestructiveDialog, {
						confirmLabel: "Delete org",
						confirmText: "acme",
						description: "This cannot be undone.",
							onConfirm: (details) => {
							window.destructiveCount += 1;
								window.destructiveSources.push(details.source);
								if (details.source !== "mouse") return;
							return new Promise((resolve) => { window.resolveDestructive = resolve; });
						},
						onOpenChange: (next, details) => {
							if (details) window.destructiveChangeSources.push(details.source);
							setOpen(next);
						},
						open,
						pendingLabel: "Deleting",
						title: "Delete Acme?",
						trigger: { label: "Open destructive dialog", size: "small" },
					}),
					createElement("button", { onClick: () => setFailureOpen(true), type: "button" }, "Open failing confirmation"),
					createElement(DestructiveDialog, {
						confirmLabel: "Retry deletion",
						description: "The service rejected this request.",
						onConfirm: async () => { throw new Error("Request failed"); },
						onOpenChange: setFailureOpen,
						open: failureOpen,
						pendingLabel: "Deleting",
						title: "Failed deletion?",
					}),
				);
			}
			function HumanOnlyDialogFixture() {
				const [open, setOpen] = useState(false);
				return createElement(AgentBoundary, { visibility: "hidden" }, createElement(DestructiveDialog, {
					agentVisibility: "hidden",
					confirmLabel: "Decline user",
					description: "The user will lose beta access.",
					onConfirm: () => { document.body.dataset.staffDecision = "declined"; },
					onOpenChange: setOpen,
					open,
					pendingLabel: "Declining",
					title: "Decline protected user?",
					trigger: { ariaLabel: "Decline protected user", label: "Decline", size: "small" },
				}));
			}
			function PrimaryDestructiveDialogFixture() {
				const [open, setOpen] = useState(false);
				return createElement(Fragment, null,
					createElement("button", { onClick: () => setOpen(true), type: "button" }, "Open primary confirmation"),
					createElement(DestructiveDialog, {
						confirmLabel: "Make admin",
						description: "This grants organization access.",
						onConfirm: () => undefined,
						onOpenChange: setOpen,
						open,
						pendingLabel: "Granting",
						title: "Make admin?",
						variant: "primary",
					}),
				);
			}
			createRoot(document.getElementById("root")).render(createElement(
					"main",
					{ className: "tripwire" },
				createElement(Dialog, {
					action: {
						label: "Save",
						onAction: save,
						pendingLabel: "Saving",
					},
					description: "Edit the workspace name.",
					initialFocus: "first-field",
					onOpenChange: (open, details) => window.regularChanges.push({ open, source: details.source }),
					title: "Edit workspace",
					trigger: createElement("button", { type: "button" }, "Open dialog"),
				}, createElement("input", { "aria-label": "Workspace name" })),
				createElement(AlertDialog, {
					confirmLabel: "Delete",
					description: "This cannot be undone.",
					onConfirm: (details) => {
						window.confirmCount += 1;
						window.confirmSources.push(details.source);
					},
					title: "Delete workspace?",
					trigger: createElement("button", { type: "button" }, "Delete workspace"),
				}),
				createElement(ControlledDialogFixture),
				createElement(FailingDialogFixture),
				createElement(MultiStepDialogFixture),
				createElement(DestructiveDialogFixture),
				createElement(PrimaryDestructiveDialogFixture),
				createElement(HumanOnlyDialogFixture),
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
			throw new Error("Dialog browser fixture produced no output");

		const browser = await chromium.launch({
			executablePath: chromiumExecutable,
			headless: true,
		});
		try {
			const context = await browser.newContext({
				viewport: { height: 640, width: 800 },
			});
			await context.route("**/*", async (route) => {
				const url = route.request().url();
				if (url === "http://dialog.test/client.js") {
					await route.fulfill({
						body: bundle,
						contentType: "text/javascript",
					});
					return;
				}
				if (url === "http://dialog.test/client.css") {
					await route.fulfill({ body: styles, contentType: "text/css" });
					return;
				}
				if (url === "http://dialog.test/") {
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
			await page.goto("http://dialog.test/");
			const protectedTrigger = page.getByRole("button", {
				name: "Decline protected user",
				exact: true,
			});
			const protectedDialog = page.getByRole("alertdialog", {
				name: "Decline protected user?",
				exact: true,
			});
			await protectedTrigger.click();
			await protectedDialog.waitFor();
			expect(
				await page.evaluate(async () => {
					const { agent } = window as unknown as DialogFixtureWindow;
					const ref = "Decline protected user?";
					const visible = agent.snapshot().some((entry) => entry.label === ref);
					const acted = await agent.act({
						steps: [{ action: "press", args: ["Decline user"], ref }],
					});
					return {
						visible,
						acted: acted.ok,
						decision: document.body.dataset.staffDecision,
					};
				}),
			).toEqual({ visible: false, acted: false, decision: undefined });
			await page.keyboard.press("Escape");
			await protectedDialog.waitFor({ state: "hidden" });
			expect(
				await protectedTrigger.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await protectedTrigger.press("Enter");
			await protectedDialog
				.getByRole("button", { name: "Decline user" })
				.press("Enter");
			await protectedDialog.waitFor({ state: "hidden" });
			expect(
				await page.locator("body").getAttribute("data-staff-decision"),
			).toBe("declined");
			const trigger = page.getByRole("button", { name: "Open dialog" });
			const publishTrigger = page.getByRole("button", {
				name: "Open publish dialog",
			});
			const publishDialog = page.getByRole("dialog", {
				name: "Publish changes",
			});
			await publishTrigger.click();
			const publish = publishDialog.getByRole("button", { name: "Publish" });
			await publish.click();
			await publishDialog.getByRole("alert").waitFor();
			expect(await publishDialog.getByRole("alert").textContent()).toBe(
				"Publishing is temporarily unavailable.",
			);
			const errorRow = publishDialog.getByRole("alert");
			expect(
				await errorRow.evaluate((element) => {
					const style = getComputedStyle(element);
					return {
						afterPanel:
							element.previousElementSibling?.getAttribute("data-slot"),
						beforeFooter: element.nextElementSibling?.getAttribute("data-slot"),
						background: style.backgroundColor,
						icon: element.querySelector('svg[aria-hidden="true"]') !== null,
						padding: style.padding,
						radius: style.borderRadius,
					};
				}),
			).toMatchObject({
				afterPanel: "dialog-panel",
				beforeFooter: "dialog-footer",
				icon: true,
				padding: "8px 12px",
				radius: "11px",
			});
			expect(
				await errorRow.evaluate(
					(element) => getComputedStyle(element).backgroundColor,
				),
			).not.toBe("rgba(0, 0, 0, 0)");
			expect(
				await publish.evaluate((button) => button === document.activeElement),
			).toBe(true);
			await publish.click();
			await publishDialog.waitFor({ state: "detached" });
			expect(
				await publishTrigger.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			const dialog = page.getByRole("dialog", { name: "Edit workspace" });
			const field = page.getByRole("textbox", { name: "Workspace name" });
			const isFocused = (selector: string) =>
				page
					.locator(selector)
					.evaluate((element) => element === document.activeElement);

			await trigger.click();
			await dialog.waitFor();
			expect(await isFocused('[aria-label="Workspace name"]')).toBe(true);
			const visualEvidence = async () =>
				dialog.evaluate((element) => {
					const content = getComputedStyle(element);
					const backdrop = getComputedStyle(
						document.querySelector('[data-slot="dialog-backdrop"]') as Element,
					);
					const footer = getComputedStyle(
						element.querySelector('[data-slot="dialog-footer"]') as Element,
					);
					const title = getComputedStyle(
						element.querySelector('[data-slot="dialog-title"]') as Element,
					);
					return {
						backdrop: backdrop.backgroundColor,
						background: content.backgroundColor,
						border: content.borderTopColor,
						footerBorder: footer.borderTopWidth,
						footerGap: footer.gap,
						footerPadding: footer.paddingInlineStart,
						titleColor: title.color,
						titleSize: title.fontSize,
						transition: content.transitionDuration,
					};
				});
			const lightVisual = await visualEvidence();
			expect(lightVisual.footerGap).toBe("8px");
			expect(lightVisual.footerPadding).toBe("3px");
			expect(lightVisual.titleSize).toBe("16px");
			expect(lightVisual.transition).toContain("0.2s");
			await page
				.locator("body")
				.evaluate((element) => element.setAttribute("data-theme", "dark"));
			const darkVisual = await visualEvidence();
			expect(darkVisual.background).not.toBe(lightVisual.background);
			expect(darkVisual.border).not.toBe(lightVisual.border);
			expect(darkVisual.titleColor).not.toBe(lightVisual.titleColor);
			expect(darkVisual.backdrop).not.toBe(lightVisual.backdrop);
			expect(darkVisual.footerBorder).toBe("0px");
			await page
				.locator("body")
				.evaluate((element) => element.setAttribute("data-theme", "light"));
			await page.emulateMedia({ reducedMotion: "reduce" });
			expect((await visualEvidence()).transition).toBe("0s");
			expect(
				await page
					.locator('[data-slot="dialog-backdrop"]')
					.evaluate((element) => getComputedStyle(element).transitionDuration),
			).toBe("0s");
			await page.emulateMedia({ reducedMotion: "no-preference" });
			const close = dialog.getByRole("button", { name: "Close" });
			const saveAction = dialog.getByRole("button", { name: "Save" });
			await close.focus();
			await close.press("Shift+Tab");
			expect(
				await saveAction.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await saveAction.press("Tab");
			expect(
				await close.evaluate((element) => element === document.activeElement),
			).toBe(true);
			await field.press("Escape");
			await dialog.waitFor({ state: "hidden" });
			expect(
				await trigger.evaluate((element) => element === document.activeElement),
			).toBe(true);

			const alertTrigger = page.getByRole("button", {
				name: "Delete workspace",
			});
			const alertDialog = page.getByRole("alertdialog", {
				name: "Delete workspace?",
			});
			await alertTrigger.click();
			await alertDialog.waitFor();
			await page.locator('[data-slot="alert-dialog-backdrop"]').click({
				position: { x: 4, y: 4 },
			});
			await alertDialog.waitFor();
			await alertDialog.getByRole("button", { name: "Cancel" }).click();
			await alertDialog.waitFor({ state: "hidden" });
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).confirmCount,
				),
			).toBe(0);
			expect(await isFocused('[data-slot="alert-dialog-trigger"]')).toBe(true);

			await alertTrigger.click();
			await alertDialog.getByRole("button", { name: "Delete" }).click();
			await alertDialog.waitFor({ state: "hidden" });
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).confirmCount,
				),
			).toBe(1);
			expect(await isFocused('[data-slot="alert-dialog-trigger"]')).toBe(true);

			await trigger.click();
			await dialog.waitFor();
			await page.locator('[data-slot="dialog-backdrop"]').click({
				position: { x: 4, y: 4 },
			});
			await dialog.waitFor({ state: "hidden" });
			expect(
				await trigger.evaluate((element) => element === document.activeElement),
			).toBe(true);

			await trigger.click();
			const action = dialog.getByRole("button", { name: "Save" });
			await action.click();
			const pendingAction = dialog.getByRole("button", { name: "Saving" });
			expect(await pendingAction.isDisabled()).toBe(true);
			expect(
				await dialog.getByRole("button", { name: "Close" }).isDisabled(),
			).toBe(true);
			expect(
				await dialog.getByRole("button", { name: "Cancel" }).isDisabled(),
			).toBe(true);
			await pendingAction.click({ force: true });
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).actionCount,
				),
			).toBe(1);
			await page.evaluate(() =>
				(window as unknown as DialogFixtureWindow).resolveAction(),
			);
			await dialog.waitFor({ state: "hidden" });
			expect(
				await trigger.evaluate((element) => element === document.activeElement),
			).toBe(true);

			const reviewTrigger = page.getByRole("button", {
				name: "Open review dialog",
			});
			await reviewTrigger.press("Enter");
			const review = page.getByRole("dialog", { name: "Review a change" });
			await review
				.getByRole("button", { name: "Continue to review" })
				.press("Enter");
			await review.getByText("Ready to confirm").waitFor();
			await page.keyboard.press("Escape");
			await review.waitFor({ state: "hidden" });
			expect(
				await reviewTrigger.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);

			const controlledTrigger = page.getByRole("button", {
				name: "Open controlled dialog",
			});
			const controlledDialog = page.getByRole("dialog", {
				name: "Controlled workspace",
			});
			await controlledTrigger.click();
			await controlledDialog.waitFor();
			await controlledDialog.getByRole("button", { name: "Close" }).click();
			await controlledDialog.waitFor({ state: "hidden" });
			expect(
				await controlledTrigger.evaluate(
					(element) => element === document.activeElement,
				),
			).toBe(true);
			await controlledTrigger.click();
			await controlledDialog.getByRole("button", { name: "Apply" }).click();
			await controlledDialog.waitFor({ state: "hidden" });
			expect(
				await page.evaluate<number>(
					() =>
						(window as unknown as DialogFixtureWindow).controlledActionCount,
				),
			).toBe(1);
			expect(
				await page.evaluate<boolean[]>(
					() => (window as unknown as DialogFixtureWindow).controlledChanges,
				),
			).toEqual([true, false, true, false]);

			await page
				.getByRole("button", { name: "Open primary confirmation" })
				.click();
			const primaryDialog = page.getByRole("alertdialog", {
				name: "Make admin?",
			});
			const primaryAction = primaryDialog.getByRole("button", {
				name: "Make admin",
			});
			const primaryBackground = await primaryAction.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			await primaryDialog.getByRole("button", { name: "Cancel" }).click();
			await primaryDialog.waitFor({ state: "detached" });

			const destructiveTrigger = page.getByRole("button", {
				name: "Open destructive dialog",
			});
			expect(await destructiveTrigger.getAttribute("data-variant")).toBe(
				"destructive",
			);
			expect(
				await destructiveTrigger.evaluate(
					(element) => element.getBoundingClientRect().height,
				),
			).toBe(26);
			await destructiveTrigger.press("Enter");
			const destructiveDialog = page.getByRole("alertdialog", {
				name: "Delete Acme?",
			});
			const destructiveAction = destructiveDialog.getByRole("button", {
				name: "Delete org",
			});
			const confirmationField = destructiveDialog.getByRole("textbox");
			await destructiveDialog.waitFor();
			const alertLayout = await destructiveDialog.evaluate((element) => {
				const panel = element.querySelector('[data-slot="alert-dialog-panel"]');
				const footer = element.querySelector('[data-slot="dialog-footer"]');
				if (!(panel && footer)) throw new Error("Missing alert dialog layout");
				return {
					inset: getComputedStyle(element).paddingInlineStart,
					panelPadding: getComputedStyle(panel).paddingInlineStart,
					footerGap: getComputedStyle(footer).columnGap,
					footerBorder: getComputedStyle(footer).borderTopWidth,
					actionHeights: [...footer.querySelectorAll("button")].map(
						(button) => button.offsetHeight,
					),
				};
			});
			expect(alertLayout).toEqual({
				inset: "3px",
				panelPadding: "16px",
				footerGap: "8px",
				footerBorder: "0px",
				actionHeights: [26, 26],
			});
			expect(await destructiveAction.isDisabled()).toBe(true);
			await confirmationField.fill("wrong");
			expect(await destructiveAction.isDisabled()).toBe(true);
			await confirmationField.fill(" acme ");
			expect(await destructiveAction.isDisabled()).toBe(true);
			await confirmationField.fill("acme ");
			expect(await destructiveAction.isDisabled()).toBe(true);
			await confirmationField.fill("acme");
			expect(await destructiveAction.isEnabled()).toBe(true);
			const destructiveBackground = await destructiveAction.evaluate(
				(element) => getComputedStyle(element).backgroundColor,
			);
			expect(primaryBackground).not.toBe(destructiveBackground);
			await destructiveAction.click();
			const pendingDestructiveAction = destructiveDialog.getByRole("button", {
				name: "Deleting",
			});
			expect(await pendingDestructiveAction.isDisabled()).toBe(true);
			expect(
				await destructiveDialog
					.getByRole("button", { name: "Cancel" })
					.isDisabled(),
			).toBe(true);
			await pendingDestructiveAction.click({ force: true });
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).destructiveCount,
				),
			).toBe(1);
			await page.locator('[data-slot="alert-dialog-backdrop"]').click({
				position: { x: 4, y: 4 },
			});
			await destructiveDialog.waitFor();
			await page.evaluate(() =>
				(window as unknown as DialogFixtureWindow).resolveDestructive(),
			);
			await destructiveDialog.waitFor({ state: "hidden" });
			await page
				.getByRole("button", { name: "Open destructive dialog" })
				.click();
			await confirmationField.fill("acme");
			await confirmationField.press("Enter");
			expect(await destructiveDialog.isVisible()).toBe(true);
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).destructiveCount,
				),
			).toBe(1);
			await destructiveAction.press("Enter");
			await destructiveDialog.waitFor({ state: "hidden" });
			await page
				.getByRole("button", { name: "Open failing confirmation" })
				.click();
			const failedConfirmation = page.getByRole("alertdialog", {
				name: "Failed deletion?",
			});
			const retry = failedConfirmation.getByRole("button", {
				name: "Retry deletion",
			});
			await retry.click();
			await failedConfirmation
				.getByRole("alert")
				.getByText("The action failed. Try again.")
				.waitFor();
			expect(await retry.isEnabled()).toBe(true);
			await failedConfirmation.getByRole("button", { name: "Cancel" }).click();
			await failedConfirmation.waitFor({ state: "detached" });

			const agentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as DialogFixtureWindow;
				const components = fixtureWindow.agent.snapshot();
				const regular = components.find(
					(component) => component.label === "Open dialog",
				);
				const alert = components.find(
					(component) => component.label === "Delete workspace",
				);
				const controlled = components.find(
					(component) => component.label === "Open controlled dialog",
				);
				if (!(regular && alert && controlled)) {
					throw new Error(JSON.stringify(components));
				}
				const refused = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: ["Delete"], ref: alert.ref }],
				});
				fixtureWindow.allowDestructive = true;
				const confirmed = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: ["Delete"], ref: alert.ref }],
				});
				const controlledOpened = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: controlled.ref }],
				});
				const controlledApplied = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: ["Apply"], ref: controlled.ref }],
				});
				const regularOpened = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: regular.ref }],
				});
				const save = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Save");
				if (!save)
					throw new Error(JSON.stringify(fixtureWindow.agent.snapshot()));
				setTimeout(() => fixtureWindow.resolveAction(), 50);
				const regularSaved = await fixtureWindow.agent.act({
					steps: [{ action: "press", args: [], ref: save.ref }],
				});
				return {
					components,
					results: [
						refused,
						confirmed,
						controlledOpened,
						controlledApplied,
						regularOpened,
						regularSaved,
					],
				};
			});
			expect(agentResults.results.map((result) => result.ok)).toEqual([
				false,
				true,
				true,
				true,
				true,
				true,
			]);
			expect(
				agentResults.components.map((component) => component.label),
			).toEqual([
				"Open dialog",
				"Delete workspace",
				"Open controlled dialog",
				"Open publish dialog",
				"Open review dialog",
				"Open destructive dialog",
			]);
			expect(
				agentResults.components.map((component) => component.actions),
			).toEqual([
				["setOpen", "press"],
				["setOpen", "press"],
				["setOpen", "press"],
				["setOpen", "press"],
				["setOpen", "press"],
				["setOpen", "press"],
			]);
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as DialogFixtureWindow).actionSources,
				),
			).toEqual(["mouse", "agent"]);
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as DialogFixtureWindow).confirmSources,
				),
			).toEqual(["mouse", "agent"]);
			expect(
				await page.evaluate<string[]>(
					() =>
						(window as unknown as DialogFixtureWindow).controlledActionSources,
				),
			).toEqual(["mouse", "agent"]);
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).confirmCount,
				),
			).toBe(2);
			expect(
				await page.evaluate<string[]>(
					() =>
						(window as unknown as DialogFixtureWindow).controlledChangeSources,
				),
			).toEqual(["mouse", "mouse", "mouse", "mouse", "agent", "agent"]);
			expect(
				await page.evaluate<Array<{ open: boolean; source: string }>>(
					() => (window as unknown as DialogFixtureWindow).regularChanges,
				),
			).toEqual([
				{ open: true, source: "mouse" },
				{ open: false, source: "keyboard" },
				{ open: true, source: "mouse" },
				{ open: false, source: "virtual" },
				{ open: true, source: "mouse" },
				{ open: false, source: "mouse" },
				{ open: true, source: "agent" },
				{ open: false, source: "agent" },
			]);

			await dialog.waitFor({ state: "hidden" });
			await page
				.getByRole("button", { name: "Open destructive dialog" })
				.click();
			await confirmationField.fill("acme");
			const destructiveAgentResults = await page.evaluate(async () => {
				const fixtureWindow = window as unknown as DialogFixtureWindow;
				const destructive = fixtureWindow.agent
					.snapshot()
					.find((component) => component.label === "Delete Acme?");
				if (!destructive) {
					throw new Error(JSON.stringify(fixtureWindow.agent.snapshot()));
				}
				fixtureWindow.allowDestructive = false;
				const refused = await fixtureWindow.agent.act({
					steps: [
						{ action: "press", args: ["Delete org"], ref: destructive.ref },
					],
				});
				fixtureWindow.allowDestructive = true;
				const confirmed = await fixtureWindow.agent.act({
					steps: [
						{ action: "press", args: ["Delete org"], ref: destructive.ref },
					],
				});
				return [refused, confirmed];
			});
			expect(destructiveAgentResults.map((result) => result.ok)).toEqual([
				false,
				true,
			]);
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as DialogFixtureWindow).destructiveSources,
				),
			).toEqual(["mouse", "keyboard", "agent"]);
			expect(
				await page.evaluate<number>(
					() => (window as unknown as DialogFixtureWindow).destructiveCount,
				),
			).toBe(3);
			expect(
				await page.evaluate<string[]>(
					() =>
						(window as unknown as DialogFixtureWindow).destructiveChangeSources,
				),
			).toEqual(["keyboard", "mouse", "mouse", "keyboard", "mouse", "agent"]);
			expect(
				await page.evaluate<string[]>(
					() => (window as unknown as DialogFixtureWindow).confirmations,
				),
			).toEqual([
				"Delete workspace?",
				"Delete workspace?",
				"Delete Acme?",
				"Delete Acme?",
			]);
			await destructiveDialog.waitFor({ state: "hidden" });
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
}, 30_000);
