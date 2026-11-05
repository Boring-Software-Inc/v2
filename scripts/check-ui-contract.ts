import { mkdir } from "node:fs/promises";
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
const executablePath =
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
	"/home/grim/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const outputRoot = ".design-system/ui-contract";
await mkdir(outputRoot, { recursive: true });

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
const reports: Record<string, JsonValue> = {};
let failed = false;
for (const width of [320, 768, 1280]) {
	for (const theme of ["light", "dark"] as const) {
		for (const zoom of [1, 2]) {
			const context = await browser.newContext({
				storageState,
				viewport: { width, height: 900 },
			});
			const page = await context.newPage();
			const consoleErrors: string[] = [];
			page.on("console", (message) => {
				if (message.type() === "error") consoleErrors.push(message.text());
			});
			await page.addInitScript((activeTheme) => {
				localStorage.setItem("theme", activeTheme);
			}, theme);
			await page.goto(`http://localhost:3001${route}`, {
				waitUntil: "domcontentloaded",
			});
			await page.locator("body").waitFor();
			await page.waitForTimeout(1500);
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
					return {
						headings,
						hierarchyFailures,
						overflow,
						roleCounts,
						rhythmFailures,
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
			];
			if (audit.overflow.scrollWidth > audit.overflow.clientWidth + 1) {
				failures.push(
					`horizontal overflow ${audit.overflow.scrollWidth}px > ${audit.overflow.clientWidth}px`,
				);
			}
			if (applicationConsoleErrors.length > 0) {
				failures.push(...applicationConsoleErrors);
			}
			const key = `${width}-${theme}-${zoom === 2 ? "zoom-200" : "zoom-100"}`;
			reports[key] = {
				...audit,
				consoleErrors: applicationConsoleErrors,
				failures,
			};
			if (failures.length > 0) failed = true;
			await page.screenshot({
				fullPage: true,
				path: `${outputRoot}/${key}.png`,
			});
			await context.close();
		}
	}
}
await browser.close();
console.log(JSON.stringify(reports, null, 2));
if (failed) process.exitCode = 1;
