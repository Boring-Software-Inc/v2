import { mkdir, rm } from "node:fs/promises";
import type { JsonValue } from "@tripwire/contracts";
import { chromium } from "playwright-core";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
	const key = process.argv[index];
	const value = process.argv[index + 1];
	if (key && value) args.set(key, value);
}
const route = args.get("--route") ?? "/login";
const storageState = args.get("--storage");
const persona = args.get("--persona");
const baseUrl = args.get("--base") ?? "http://localhost:3001";
const sidebarState = args.get("--sidebar");
if (
	sidebarState !== undefined &&
	sidebarState !== "collapsed" &&
	sidebarState !== "expanded"
) {
	throw new Error('--sidebar must be either "collapsed" or "expanded"');
}
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const outputRoot = ".design-system/ui-contract";
await mkdir(outputRoot, { recursive: true });
const routeKey =
	route.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-") || "root";
const runKey = [routeKey, sidebarState ?? "no-sidebar"].join("--");
const outputDirectory = `${outputRoot}/${runKey}`;
await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });

const expectedTypeSizes = {
	"page-title": 28,
	"section-heading": 20,
	subheading: 16,
	body: 14,
	"supporting-text": 13,
	label: 13,
	caption: 12,
	"code-text": 11.2,
} satisfies Record<string, number>;
const expectedGaps = {
	"page-body": 24,
	section: 12,
	"section-body": 12,
	"action-row": 8,
} satisfies Record<string, number>;

const browser = await chromium.launch({ executablePath, headless: true });
let activeStorageState = storageState;
if (persona) {
	const authContext = await browser.newContext();
	const response = await authContext.request.post(`${baseUrl}/api/dev/login`, {
		data: { persona },
	});
	if (!response.ok()) {
		throw new Error(
			`could not create dev persona ${persona}: ${response.status()} ${await response.text()}`,
		);
	}
	activeStorageState = `${outputRoot}/auth-state.json`;
	await authContext.storageState({ path: activeStorageState });
	await authContext.close();
}
const reports: Record<string, JsonValue> = {};
let failed = false;
for (const width of [390, 768, 1280, 1920]) {
	for (const theme of ["light", "dark"] as const) {
		for (const zoom of [1, 2]) {
			for (const reducedMotion of ["no-preference", "reduce"] as const) {
				const context = await browser.newContext({
					reducedMotion,
					storageState: activeStorageState,
					viewport: { width, height: 900 },
				});
				if (sidebarState) {
					await context.addCookies([
						{
							name: "tripwire-sidebar-collapsed",
							url: new URL(baseUrl).origin,
							value: sidebarState === "collapsed" ? "1" : "0",
						},
					]);
				}
				const page = await context.newPage();
				const consoleErrors: string[] = [];
				page.on("console", (message) => {
					if (message.type() === "error") consoleErrors.push(message.text());
				});
				await page.addInitScript((activeTheme) => {
					localStorage.setItem("theme", activeTheme);
				}, theme);
				await page.goto(`${baseUrl}${route}`, {
					waitUntil: "load",
				});
				await page.locator("body").waitFor();
				await page.waitForTimeout(1500);
				const railLocator = page.locator('[data-layout-role="dashboard-rail"]');
				if (sidebarState && width >= 1024) {
					await railLocator.waitFor({ state: "visible", timeout: 10_000 });
				}
				if (sidebarState && (await railLocator.isVisible())) {
					await railLocator.waitFor({ state: "visible", timeout: 10_000 });
					const settingsRail = railLocator.locator(
						'[data-layout-role="settings-sidebar-back-group"]',
					);
					if (
						sidebarState === "expanded" &&
						!(await settingsRail.isVisible())
					) {
						const scopeLabel = railLocator.locator(
							'[data-layout-role="scope-switcher-label"]',
						);
						await scopeLabel.waitFor({ state: "visible", timeout: 10_000 });
						await page.waitForTimeout(500);
						await scopeLabel.waitFor({ state: "visible", timeout: 10_000 });
					}
				}
				if (await page.locator('[data-layout-role="page"]').count()) {
					await page
						.locator('[data-layout-role="page"] [data-type-role="page-title"]')
						.first()
						.waitFor({ state: "attached", timeout: 10_000 })
						.catch(() => undefined);
				}
				const interactionFailures: string[] = [];
				const searchTrigger = railLocator.locator(
					'[data-layout-role="sidebar-search-trigger"]',
				);
				if (
					sidebarState &&
					(await railLocator.isVisible()) &&
					!(await railLocator
						.locator('[data-layout-role="settings-sidebar-back-group"]')
						.isVisible()) &&
					!(await searchTrigger.isVisible())
				) {
					interactionFailures.push(
						"dashboard sidebar Search trigger is missing",
					);
				}
				if (sidebarState && (await searchTrigger.isVisible())) {
					const restingBackground = await searchTrigger.evaluate(
						(element) => getComputedStyle(element).backgroundColor,
					);
					await searchTrigger.hover();
					await page.waitForTimeout(100);
					const hoverBackground = await searchTrigger.evaluate(
						(element) => getComputedStyle(element).backgroundColor,
					);
					if (hoverBackground === restingBackground) {
						interactionFailures.push(
							"sidebar Search hover has no visible background response",
						);
					}
					await page.mouse.move(width - 1, 1);
					await page.getByRole("link", { name: "Skip to content" }).focus();
					let searchFocused = false;
					for (let index = 0; index < 12; index += 1) {
						await page.keyboard.press("Tab");
						searchFocused = await searchTrigger.evaluate(
							(element) => document.activeElement === element,
						);
						if (searchFocused) break;
					}
					if (!searchFocused) {
						interactionFailures.push(
							"sidebar Search is not reachable in the first 12 keyboard stops",
						);
					} else {
						const focusVisible = await searchTrigger.evaluate((element) => {
							const style = getComputedStyle(element);
							return (
								style.outlineStyle !== "none" &&
								Number.parseFloat(style.outlineWidth) > 0
							);
						});
						if (!focusVisible) {
							interactionFailures.push(
								"sidebar Search has no visible keyboard focus outline",
							);
						}
					}
				}
				const finalPathname = new URL(page.url()).pathname;
				const applicationConsoleErrors = [...consoleErrors];
				if (zoom === 2) {
					await page.evaluate(() => {
						for (const element of document.querySelectorAll<HTMLElement>("*")) {
							const ownsText = [...element.childNodes].some(
								(node) =>
									node.nodeType === Node.TEXT_NODE &&
									Boolean(node.textContent?.trim()),
							);
							if (!ownsText) continue;
							const style = getComputedStyle(element);
							const fontSize = Number.parseFloat(style.fontSize);
							const lineHeight = Number.parseFloat(style.lineHeight);
							if (Number.isFinite(fontSize)) {
								element.style.fontSize = `${fontSize * 2}px`;
							}
							if (Number.isFinite(lineHeight)) {
								element.style.lineHeight = `${lineHeight * 2}px`;
							}
						}
					});
					await page.waitForTimeout(100);
				}
				const audit = await page.evaluate(
					({ sizes, gaps, applyScaleAudit }) => {
						const visible = (element: Element) =>
							element.getClientRects().length > 0 &&
							getComputedStyle(element).visibility !== "hidden";
						const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")]
							.filter(visible)
							.map((element) => ({
								level: Number(element.tagName.slice(1)),
								text: element.textContent?.trim() ?? "",
							}));
						const hierarchyFailures: string[] = [];
						for (let index = 1; index < headings.length; index += 1) {
							const previous = headings[index - 1];
							const current = headings[index];
							if (previous && current && current.level > previous.level + 1) {
								hierarchyFailures.push(
									`heading skipped from h${previous.level} to h${current.level}: ${current.text}`,
								);
							}
						}
						const roleElements = [
							...document.querySelectorAll<HTMLElement>("[data-type-role]"),
						].filter(visible);
						const roleCounts: Record<string, number> = {};
						const typeFailures: string[] = [];
						for (const element of roleElements) {
							const role = element.dataset.typeRole ?? "";
							roleCounts[role] = (roleCounts[role] ?? 0) + 1;
							const expected = Object.entries(sizes).find(
								([name]) => name === role,
							)?.[1];
							if (applyScaleAudit && expected !== undefined) {
								const actual = Number.parseFloat(
									getComputedStyle(element).fontSize,
								);
								if (Math.abs(actual - expected) > 0.1) {
									typeFailures.push(
										`${role}: ${actual}px, expected ${expected}px`,
									);
								}
							}
						}
						if ((roleCounts["page-title"] ?? 0) > 1) {
							typeFailures.push("more than one PageTitle");
						}
						if (document.querySelector('[data-layout-role="page"]')) {
							if ((roleCounts["page-title"] ?? 0) !== 1) {
								typeFailures.push(
									"semantic Page must contain exactly one PageTitle",
								);
							}
						}
						const rhythmFailures: string[] = [];
						for (const element of document.querySelectorAll<HTMLElement>(
							"[data-layout-role]",
						)) {
							if (!visible(element)) continue;
							const role = element.dataset.layoutRole ?? "";
							const expected = Object.entries(gaps).find(
								([name]) => name === role,
							)?.[1];
							if (applyScaleAudit && expected !== undefined) {
								const style = getComputedStyle(element);
								const actual = Number.parseFloat(style.rowGap || style.gap);
								if (Math.abs(actual - expected) > 0.1) {
									rhythmFailures.push(
										`${role}: ${actual}px, expected ${expected}px`,
									);
								}
							}
						}
						const nestedRoles = [
							...document.querySelectorAll<HTMLElement>(
								"[data-type-role] [data-type-role]",
							),
						].filter(visible).length;
						if (nestedRoles > 0)
							typeFailures.push(`${nestedRoles} nested typography roles`);
						const overflow = {
							clientWidth: document.documentElement.clientWidth,
							scrollWidth: document.documentElement.scrollWidth,
						};
						const rail = document.querySelector<HTMLElement>(
							'[data-layout-role="dashboard-rail"]',
						);
						const shellFailures: string[] = [];
						const shell = (() => {
							if (!rail || !visible(rail)) return null;
							const measurement = (selector: string) => {
								const element = rail.querySelector<HTMLElement>(selector);
								if (!element || !visible(element)) return null;
								const rect = element.getBoundingClientRect();
								return {
									centerX: rect.left + rect.width / 2,
									height: rect.height,
									left: rect.left,
									width: rect.width,
								};
							};
							const railRect = rail.getBoundingClientRect();
							const collapsed = rail.dataset.collapsed === "true";
							const expectedWidth = collapsed ? 50 : 224;
							if (Math.abs(railRect.width - expectedWidth) > 0.5) {
								shellFailures.push(
									`rail width ${railRect.width}px, expected ${expectedWidth}px`,
								);
							}
							const brand = measurement(
								'[data-layout-role="sidebar-brand-link"] svg, [data-layout-role="sidebar-brand-mark"] svg',
							);
							const search = measurement(
								'[data-layout-role="sidebar-search-icon"] svg',
							);
							const nav = [
								...rail.querySelectorAll<HTMLElement>(
									'[data-layout-role="sidebar-nav-icon"] svg',
								),
							]
								.filter(visible)
								.map((element) => {
									const rect = element.getBoundingClientRect();
									return {
										centerX: rect.left + rect.width / 2,
										height: rect.height,
										left: rect.left,
										width: rect.width,
									};
								});
							const account = measurement(
								'[data-layout-role="sidebar-account-trigger"] [data-slot="avatar"]',
							);
							const interactiveRects = [
								rail.querySelector<HTMLElement>(
									'[data-layout-role="sidebar-brand-toggle"]',
								),
								rail.querySelector<HTMLElement>(
									'[data-layout-role="sidebar-search-trigger"]',
								),
								...[
									...rail.querySelectorAll<HTMLElement>(
										'[data-layout-role="sidebar-nav-icon"]',
									),
								].map((icon) => icon.closest<HTMLElement>("a, button")),
								rail.querySelector<HTMLElement>(
									'[data-layout-role="sidebar-account-trigger"]',
								),
							].filter(
								(value): value is HTMLElement =>
									value !== null && visible(value),
							);
							const expectedHitArea = Number.parseFloat(
								getComputedStyle(rail).getPropertyValue("--control-sm"),
							);
							for (const interactive of interactiveRects) {
								const rect = interactive.getBoundingClientRect();
								if (
									!Number.isFinite(expectedHitArea) ||
									rect.width < expectedHitArea ||
									rect.height < expectedHitArea
								) {
									shellFailures.push(
										`rail hit area ${rect.width}x${rect.height}px, expected at least ${expectedHitArea}x${expectedHitArea}px`,
									);
								}
							}
							const labelRoles = {
								account: '[data-layout-role="sidebar-account-label"]',
								navigation: '[data-layout-role="sidebar-nav-label"]',
								repository: '[data-layout-role="scope-switcher-label"]',
								search: '[data-layout-role="sidebar-search-label"]',
								shortcut: '[data-layout-role="sidebar-search-shortcut"]',
							} as const;
							const settingsRail = rail.querySelector(
								'[data-layout-role="settings-sidebar-back-group"]',
							);
							for (const [role, selector] of Object.entries(labelRoles)) {
								if (
									settingsRail &&
									["repository", "search", "shortcut"].includes(role)
								)
									continue;
								const visibleCount = [
									...rail.querySelectorAll<HTMLElement>(selector),
								].filter(visible).length;
								if (collapsed && visibleCount > 0) {
									shellFailures.push(
										`${role} label remains visible while collapsed`,
									);
								}
								if (!collapsed && visibleCount === 0) {
									shellFailures.push(
										`expanded rail has no visible ${role} label`,
									);
								}
								if (
									!collapsed &&
									role === "navigation" &&
									visibleCount !== nav.length
								) {
									shellFailures.push(
										`expanded rail has ${visibleCount} navigation labels for ${nav.length} navigation icons`,
									);
								}
							}
							const aligned = [search, ...nav].filter(
								(value): value is NonNullable<typeof value> => value !== null,
							);
							const referenceCenter = nav[0]?.centerX ?? search?.centerX;
							if (referenceCenter !== undefined) {
								for (const item of aligned) {
									if (Math.abs(item.centerX - referenceCenter) > 0.5) {
										shellFailures.push(
											`rail item center ${item.centerX}px, expected ${referenceCenter}px`,
										);
									}
								}
								if (brand && Math.abs(brand.centerX - referenceCenter) > 0.5) {
									shellFailures.push(
										`brand center ${brand.centerX}px, expected ${referenceCenter}px`,
									);
								}
								if (account) {
									const accountDelta = collapsed
										? Math.abs(account.centerX - referenceCenter)
										: Math.abs(
												account.left -
													(nav[0]?.left ?? search?.left ?? account.left),
											);
									if (accountDelta > 1) {
										shellFailures.push(
											collapsed
												? `account center ${account.centerX}px, expected ${referenceCenter}px ± 1px`
												: `account left edge ${account.left}px must align with the rail icon column ± 1px`,
										);
									}
								}
							}
							for (const icon of [search, ...nav].filter(
								(value): value is NonNullable<typeof value> => value !== null,
							)) {
								if (
									Math.abs(icon.width - 16) > 0.5 ||
									Math.abs(icon.height - 16) > 0.5
								) {
									shellFailures.push(
										`rail icon ${icon.width}x${icon.height}px, expected 16x16px`,
									);
								}
							}
							return {
								account,
								brand,
								collapsed,
								nav,
								railWidth: railRect.width,
								search,
								transitionMilliseconds: Math.max(
									...getComputedStyle(rail)
										.transitionDuration.split(",")
										.map((duration) => {
											const value = Number.parseFloat(duration);
											return duration.trim().endsWith("ms")
												? value
												: value * 1000;
										}),
								),
							};
						})();
						return {
							headings,
							hierarchyFailures,
							overflow,
							roleCounts,
							rhythmFailures,
							shell,
							shellFailures,
							typeFailures,
						};
					},
					{
						applyScaleAudit: zoom === 1,
						gaps: expectedGaps,
						sizes: expectedTypeSizes,
					},
				);
				const failures = [
					...audit.hierarchyFailures,
					...audit.typeFailures,
					...audit.rhythmFailures,
					...audit.shellFailures,
					...interactionFailures,
				];
				const transitionFailures: string[] = [];
				if (
					sidebarState &&
					width === 1280 &&
					theme === "light" &&
					zoom === 1 &&
					reducedMotion === "no-preference" &&
					(await railLocator.isVisible())
				) {
					const initialWidth = await railLocator.evaluate(
						(element) => element.getBoundingClientRect().width,
					);
					const initialToggle = railLocator.getByRole("button", {
						exact: true,
						name:
							sidebarState === "collapsed"
								? "Expand sidebar"
								: "Collapse sidebar",
					});
					await initialToggle.evaluate((element) => element.click());
					await page.waitForTimeout(50);
					const reversalWidth = await railLocator.evaluate(
						(element) => element.getBoundingClientRect().width,
					);
					if (reversalWidth <= 50.5 || reversalWidth >= 223.5) {
						transitionFailures.push(
							`rail reversal occurred at ${reversalWidth}px instead of between semantic endpoints`,
						);
					}
					const reversingToggle = railLocator.getByRole("button", {
						exact: true,
						name:
							sidebarState === "collapsed"
								? "Collapse sidebar"
								: "Expand sidebar",
					});
					await reversingToggle.waitFor({ state: "visible", timeout: 2_000 });
					await reversingToggle.evaluate((element) => element.click());
					const samples: number[] = [];
					for (let index = 0; index < 18; index += 1) {
						samples.push(
							await railLocator.evaluate(
								(element) => element.getBoundingClientRect().width,
							),
						);
						await page.waitForTimeout(16);
					}
					const expectedDirection = sidebarState === "collapsed" ? -1 : 1;
					for (let index = 1; index < samples.length; index += 1) {
						const previous = samples[index - 1];
						const current = samples[index];
						if (
							previous !== undefined &&
							current !== undefined &&
							(current - previous) * expectedDirection < -0.75
						) {
							transitionFailures.push(
								`interrupted rail transition reversed between ${previous}px and ${current}px`,
							);
							break;
						}
					}
					if (samples.some((sample) => sample < 49.5 || sample > 224.5)) {
						transitionFailures.push(
							`interrupted rail transition exceeded semantic bounds: ${samples.join(", ")}`,
						);
					}
					const finalWidth = samples.at(-1);
					if (
						finalWidth === undefined ||
						Math.abs(finalWidth - initialWidth) > 0.5
					) {
						transitionFailures.push(
							`interrupted rail transition settled at ${finalWidth ?? "no sample"}px, expected ${initialWidth}px`,
						);
					}
					failures.push(...transitionFailures);
				}
				if (
					reducedMotion === "reduce" &&
					audit.shell !== null &&
					audit.shell.transitionMilliseconds > 0.01
				) {
					failures.push(
						`reduced-motion rail transition is ${audit.shell.transitionMilliseconds}ms`,
					);
				}
				if (audit.overflow.scrollWidth > audit.overflow.clientWidth + 1) {
					failures.push(
						`horizontal overflow ${audit.overflow.scrollWidth}px > ${audit.overflow.clientWidth}px`,
					);
				}
				if (applicationConsoleErrors.length > 0) {
					failures.push(...applicationConsoleErrors);
				}
				if (sidebarState && finalPathname !== route) {
					failures.push(
						`authenticated route redirected to ${finalPathname}, expected ${route}`,
					);
				}
				if (sidebarState && width >= 1024 && audit.shell === null) {
					failures.push(
						"authenticated desktop route did not render a dashboard rail",
					);
				}
				const key = `${width}-${theme}-${zoom === 2 ? "zoom-200" : "zoom-100"}-${reducedMotion === "reduce" ? "reduced-motion" : "motion"}`;
				reports[key] = {
					...audit,
					consoleErrors: applicationConsoleErrors,
					failures,
					finalPathname,
					interactionFailures,
					transitionFailures,
				};
				if (failures.length > 0) failed = true;
				await page.mouse.move(width - 1, 1);
				await page.evaluate(() => {
					(document.activeElement as HTMLElement | null)?.blur();
				});
				await page.waitForTimeout(300);
				await page.screenshot({
					fullPage: true,
					path: `${outputDirectory}/${key}.png`,
				});
				await context.close();
			}
		}
	}
}
await browser.close();
console.log(JSON.stringify(reports, null, 2));
if (failed) process.exitCode = 1;
