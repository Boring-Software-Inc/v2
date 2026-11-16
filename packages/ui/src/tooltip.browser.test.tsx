import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Route } from "playwright-core";

interface TooltipFixtureWindow extends Window {
	agent: {
		act(input: {
			steps: Array<{ action: string; args: boolean[]; ref: string }>;
		}): Promise<{ ok: boolean }>;
		snapshot(): Array<{ component: string; ref: string }>;
	};
	openChanges: Array<{ open: boolean; source: string }>;
	controlledChanges: Array<{ open: boolean; source: string }>;
}

test("Tooltip preserves sidebar fade, standard hover and focus, and agent interaction", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-tooltip-"));
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const entrypoint = join(directory, "client.tsx");
	try {
		await writeFile(
			entrypoint,
			`
			import ${JSON.stringify(join(root, "packages/ui/src/styles/theme.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/base.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/color.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/components.css"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { createElement as h } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createAgent } from ${JSON.stringify(join(root, "node_modules/@ui-sdk/react/dist/agent.js"))};
			import { Tooltip } from ${JSON.stringify(fileURLToPath(new URL("./tooltip.tsx", import.meta.url)))};
			window.agent = createAgent();
			window.openChanges = [];
			window.controlledChanges = [];
			createRoot(document.querySelector("#root")).render(
				h("main", null,
					h("div", {id:"rail", style:{width:50, display:"flex", alignItems:"center", justifyContent:"center"}},
						h(Tooltip, {variant:"sidebar", offset:"spacious", trigger:h("button", {type:"button", style:{width:26}}, "Search")}, "Search commands")),
					h("div", {style:{marginTop:80, marginLeft:120}},
						h(Tooltip, {onOpenChange:(open, {source}) => window.openChanges.push({open, source}),
							trigger:h("button", {type:"button"}, h("svg", {"aria-hidden":true, width:12, height:12}))}, "Copy run ID"),
						h(Tooltip, {open:false, onOpenChange:(open, {source}) => window.controlledChanges.push({open, source}),
							trigger:h("button", {type:"button"}, "Controlled")}, "Controlled hint"))),
			);
		`,
		);
		const build = await Bun.build({
			entrypoints: [entrypoint],
			target: "browser",
		});
		const js = await build.outputs
			.find((output) => output.path.endsWith(".js"))
			?.text();
		const css = await build.outputs
			.find((output) => output.path.endsWith(".css"))
			?.text();
		if (!(js && css)) throw new Error("Tooltip fixture did not bundle");
		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		});
		try {
			const page = await browser.newPage();
			page.setDefaultTimeout(2_000);
			const serveFixture = (route: Route) =>
				new URL(route.request().url()).pathname === "/client.js"
					? route.fulfill({ body: js, contentType: "text/javascript" })
					: route.fulfill({
							contentType: "text/html",
							body: `<!doctype html><style>${css}</style><body class="tripwire" data-system="tripwire"><div id="root"></div><script type="module" src="/client.js"></script>`,
						});
			await page.route("**/*", serveFixture);
			await page.goto("http://tooltip.test/");
			const trigger = page.getByRole("button", { name: "Search", exact: true });
			const tip = page.getByRole("tooltip", { name: "Search commands" });
			await trigger.evaluate((node) => {
				node.addEventListener(
					"pointerenter",
					() => Reflect.set(document.body, "hoverAt", performance.now()),
					{ once: true },
				);
			});
			await trigger.hover();
			const firstFrame = await tip.evaluate((node) => {
				const rail = document.querySelector("#rail");
				if (!rail) throw new Error("Missing fixture rail");
				const style = getComputedStyle(node);
				return {
					delay:
						performance.now() - Number(Reflect.get(document.body, "hoverAt")),
					gap:
						node.getBoundingClientRect().left -
						rail.getBoundingClientRect().right,
					duration: style.transitionDuration,
					property: style.transitionProperty,
					radius: style.borderRadius,
					height: node.getBoundingClientRect().height,
				};
			});
			expect(firstFrame.delay).toBeLessThan(150);
			expect(firstFrame.gap).toBe(8);
			expect(firstFrame.duration).toBe("0.16s");
			expect(firstFrame.property).toBe("opacity");
			expect(firstFrame.radius).toBe("13px");
			expect(firstFrame.height).toBe(34);
			expect(await trigger.getAttribute("aria-describedby")).toBe(
				await tip.getAttribute("id"),
			);
			await page.keyboard.press("Escape");
			await tip.waitFor({ state: "hidden" });
			await page.mouse.move(300, 300);
			await page.reload();
			const copy = page.getByRole("button", { name: "Copy run ID" });
			const copyTip = page.getByRole("tooltip", { name: "Copy run ID" });
			await copy.evaluate((node) => {
				node.addEventListener(
					"pointerenter",
					() => Reflect.set(document.body, "hoverAt", performance.now()),
					{ once: true },
				);
			});
			await copy.hover();
			expect(await copyTip.count()).toBe(0);
			const standardEntry = await copyTip.evaluate((node) => ({
				elapsed:
					performance.now() - Number(Reflect.get(document.body, "hoverAt")),
				side: node.getAttribute("data-side"),
				duration: getComputedStyle(node).transitionDuration,
			}));
			expect(standardEntry.elapsed).toBeGreaterThanOrEqual(450);
			expect(standardEntry.side).toBe("top");
			expect(standardEntry.duration).toBe("0.2s, 0.2s");
			await page.waitForFunction(() => {
				const tip = document.querySelector(
					'[data-slot="tooltip-content"]:not([hidden])',
				);
				return tip && Number(getComputedStyle(tip).opacity) === 1;
			});
			const standardGap = await copyTip.evaluate((tip) => {
				const button = document.querySelector('[aria-label="Copy run ID"]');
				if (!button) throw new Error("Missing tooltip anchor");
				return (
					button.getBoundingClientRect().top -
					tip.getBoundingClientRect().bottom
				);
			});
			expect(standardGap).toBeCloseTo(6, 0);
			const controlled = page.getByRole("button", { name: "Controlled" });
			await controlled.hover();
			await page.waitForFunction(() =>
				(window as unknown as TooltipFixtureWindow).controlledChanges.some(
					({ open }) => open,
				),
			);
			expect(
				await page.getByRole("tooltip", { name: "Controlled hint" }).count(),
			).toBe(0);
			await copy.hover();
			await copyTip.waitFor();
			expect(await copyTip.getAttribute("data-instant")).not.toBeNull();
			expect(
				await copyTip.evaluate(
					(node) => getComputedStyle(node).transitionDuration,
				),
			).toBe("0s");
			await page.mouse.move(300, 300);
			await copyTip.waitFor({ state: "hidden" });
			await page.keyboard.press("Tab");
			await page.keyboard.press("Tab");
			await copyTip.waitFor();
			await page.keyboard.press("Escape");
			await copyTip.waitFor({ state: "hidden" });
			await copy.blur();
			const agentResult = await page.evaluate(async () => {
				const { agent, openChanges } =
					window as unknown as TooltipFixtureWindow;
				const entries = agent
					.snapshot()
					.filter(({ component }) => component === "tooltip");
				for (const { ref } of entries) {
					const result = await agent.act({
						steps: [{ action: "setOpen", args: [true], ref }],
					});
					if (openChanges.at(-1)?.source === "agent") return result;
				}
				return { ok: false };
			});
			expect(agentResult.ok).toBe(true);
			await copyTip.waitFor();
			await page.keyboard.press("Escape");
			await copyTip.waitFor({ state: "hidden" });
			await page.emulateMedia({
				reducedMotion: "reduce",
				forcedColors: "active",
			});
			await trigger.focus();
			await tip.waitFor();
			expect(
				await tip.evaluate((node) => getComputedStyle(node).transitionDuration),
			).toBe("0s");
			expect(
				await tip.evaluate((node) => getComputedStyle(node).outlineStyle),
			).toBe("solid");
			const touchPage = await browser.newPage({
				hasTouch: true,
				viewport: { width: 360, height: 640 },
			});
			await touchPage.route("**/*", serveFixture);
			await touchPage.goto("http://tooltip.test/");
			await touchPage.getByRole("button", { name: "Copy run ID" }).tap();
			expect(await touchPage.getByRole("tooltip").count()).toBe(0);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
