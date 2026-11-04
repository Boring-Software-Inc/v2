import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DatabuddyAnalytics } from "./databuddy-analytics";

const stagingId = "a512e6bc-385f-4b92-bceb-0692519edfc7";

test.skipIf(!process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)(
	"analytics hydrates with the public ID and installs exactly one pinned loader through updates and remounts",
	async () => {
		const appUrl = process.env.TRIPWIRE_DATABUDDY_TEST_APP_URL;
		if (
			appUrl &&
			!["127.0.0.1", "localhost"].includes(new URL(appUrl).hostname)
		) {
			throw new Error("Browser verification requires a local disposable app");
		}
		const directory = await mkdtemp(join(tmpdir(), "tripwire-databuddy-"));
		const web = fileURLToPath(new URL("../../../", import.meta.url));
		const entrypoint = join(directory, "client.ts");
		try {
			await writeFile(
				entrypoint,
				`
			import { createElement } from ${JSON.stringify(join(web, "node_modules/react/index.js"))};
			import { hydrateRoot } from ${JSON.stringify(join(web, "node_modules/react-dom/client.js"))};
			import { DatabuddyAnalytics } from ${JSON.stringify(fileURLToPath(new URL("./databuddy-analytics.tsx", import.meta.url)))};
			const element = () => createElement(DatabuddyAnalytics, { websiteId: ${JSON.stringify(stagingId)} });
			let root = hydrateRoot(document.getElementById("root"), element());
			window.rerenderAnalytics = () => root.render(element());
			window.remountAnalytics = () => { root.unmount(); root = hydrateRoot(document.getElementById("root"), element()); };
		`,
			);
			const build = await Bun.build({
				entrypoints: [entrypoint],
				target: "browser",
			});
			expect(build.success).toBe(true);
			const bundle = await build.outputs[0]?.text();
			if (!bundle) throw new Error("Browser fixture build produced no output");
			expect(bundle).not.toContain("TESTCANARY");
			const html = renderToString(
				createElement(DatabuddyAnalytics, { websiteId: stagingId }),
			);
			expect(html).toBe("");
			const browser = await chromium.launch({
				headless: true,
				chromiumSandbox: true,
				executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
			});
			try {
				const context = await browser.newContext();
				const external: string[] = [];
				await context.route("**/*", async (route) => {
					const url = route.request().url();
					if (url === "http://databuddy.test/client.js") {
						await route.fulfill({
							contentType: "text/javascript",
							body: bundle,
						});
					} else if (url === "http://databuddy.test/") {
						await route.fulfill({
							contentType: "text/html",
							body: `<div id="root">${html}</div><script type="module" src="/client.js"></script>`,
						});
					} else if (appUrl && new URL(url).origin === new URL(appUrl).origin) {
						await route.continue();
					} else if (url.startsWith("https://api.databuddy.cc/public/")) {
						external.push(url);
						await route.fulfill({ json: { flags: {} } });
					} else {
						external.push(url);
						await route.abort();
					}
				});
				const page = await context.newPage();
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await page.goto("http://databuddy.test/");
				await page.waitForSelector("script[data-databuddy-injected]", {
					state: "attached",
				});
				const assertLoader = async () => {
					const attributes = await page
						.locator("script[data-databuddy-injected]")
						.evaluateAll((scripts) =>
							scripts.map((script) =>
								Object.fromEntries(
									Array.from(script.attributes, (attribute) => [
										attribute.name,
										attribute.value,
									]),
								),
							),
						);
					expect(attributes).toEqual([
						{
							src: "https://cdn.databuddy.cc/databuddy.v21.js",
							"data-databuddy-injected": "true",
							"data-client-id": stagingId,
							"data-track-hash-changes": "true",
							"data-track-attributes": "true",
							"data-track-outgoing-links": "true",
							"data-track-interactions": "true",
							"data-track-web-vitals": "true",
							"data-track-errors": "true",
							integrity:
								"sha384-m2c2os7/DpqI3ZXwXLHVY6KrzL/iLwn+yuxTPwZskc+miPMNHCWBfyTojAqMXl1",
							crossorigin: "anonymous",
							async: "",
						},
					]);
					expect(await page.locator('script[src*="replay"]').count()).toBe(0);
				};
				await assertLoader();
				await page.evaluate("window.rerenderAnalytics()");
				await assertLoader();
				await page.evaluate("window.remountAnalytics()");
				await page.waitForSelector("script[data-databuddy-injected]", {
					state: "attached",
				});
				await assertLoader();
				expect(errors).toEqual([]);
				expect(
					external.every(
						(url) => url === "https://cdn.databuddy.cc/databuddy.v21.js",
					),
				).toBe(true);
				if (appUrl) {
					const response = await page.goto(`${appUrl}/login`);
					if (!response) throw new Error("No local app response");
					const source = await response.text();
					expect(source).toContain(stagingId);
					expect(source).not.toContain("TESTCANARY");
					expect(source).not.toContain("09661145-7249-45d9-a9e3-f1a93e9c7266");
					await page.waitForSelector("script[data-databuddy-injected]", {
						state: "attached",
					});
					await assertLoader();
					await page.waitForFunction("Boolean(window.__databuddyFlags)");
					expect(
						await page.evaluate<string>(
							"window.__databuddyFlags.config.clientId",
						),
					).toBe(stagingId);
					expect(await page.content()).not.toContain("TESTCANARY");
					await page.evaluate(
						"window.__TSR_ROUTER__.navigate({ to: '/oauth/popup-callback', search: { mode: 'popup', error: 'test' } })",
					);
					await page.waitForURL("**/oauth/popup-callback?**");
					await page.waitForSelector("script[data-databuddy-injected]", {
						state: "attached",
					});
					await assertLoader();
					expect(
						await page.evaluate<string>(
							"window.__databuddyFlags.config.clientId",
						),
					).toBe(stagingId);
					expect(errors).toEqual([]);
					expect(
						external
							.filter((url) => url.includes("/public/"))
							.every(
								(url) =>
									new URL(url).searchParams.get("clientId") === stagingId,
							),
					).toBe(true);
				}
			} finally {
				await browser.close();
			}
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	},
	30_000,
);
