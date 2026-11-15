import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

test("controlled Tabs select by pointer and keyboard without invoking adjacent actions", async () => {
	const root = fileURLToPath(new URL("../../../", import.meta.url));
	const directory = await mkdtemp(join(tmpdir(), "tripwire-tabs-"));
	try {
		const entrypoint = join(directory, "client.ts");
		await writeFile(
			entrypoint,
			`
			import ${JSON.stringify(join(root, "packages/ui/src/styles/theme.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/base.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/color.css"))};
			import ${JSON.stringify(join(root, "packages/ui/src/styles/components.css"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { createElement as h, useState } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createAgent } from ${JSON.stringify(join(root, "node_modules/@ui-sdk/react/dist/agent.js"))};
			import { Tabs } from ${JSON.stringify(fileURLToPath(new URL("./tabs.tsx", import.meta.url)))};
			window.tabsAgent = createAgent();
			function Fixture() {
				const [value, setValue] = useState("members");
				const [invites, setInvites] = useState(0);
				return h(Tabs, {
					ariaLabel: "Workspace access",
					size: "small",
					actions: [{ label: "Invite member", value: "invite", onAction: () => setInvites(invites + 1) }],
					items: [
						{ value: "members", label: "Members", count: 3, content: "Member list" },
						{ value: "pending", label: "Pending", content: "Invite list (" + invites + ")" },
						{ value: "disabled", label: "Disabled", disabled: true, content: "Unavailable" },
						{ value: "history", label: "Invitation history", content: "History" },
					],
					onValueChange: (next, { source }) => {
						document.body.dataset.tabsSource = source;
						setValue(next);
					},
					value,
				});
			}
			createRoot(document.querySelector("#root")).render(h(Fixture));
		`,
		);
		const build = await Bun.build({ entrypoints: [entrypoint] });
		const js = await build.outputs
			.find((file) => file.path.endsWith(".js"))
			?.text();
		const css = await build.outputs
			.find((file) => file.path.endsWith(".css"))
			?.text();
		if (!(js && css)) throw new Error("Tabs fixture did not bundle");
		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		});
		try {
			const page = await browser.newPage();
			page.setDefaultTimeout(2_000);
			await page.route("**/*", (route) =>
				new URL(route.request().url()).pathname === "/client.js"
					? route.fulfill({ body: js, contentType: "text/javascript" })
					: route.fulfill({
							body: `<!doctype html><style>${css}</style><body class="tripwire" data-system="tripwire"><div id="root"></div><script type="module" src="/client.js"></script>`,
							contentType: "text/html",
						}),
			);
			await page.goto("http://tabs.test/");
			const members = page.getByRole("tab", { name: /Members/ });
			const pending = page.getByRole("tab", { name: "Pending" });
			expect((await members.boundingBox())?.height).toBe(26);
			expect(
				await members
					.getByText("3", { exact: true })
					.evaluate((node) => getComputedStyle(node).fontVariantNumeric),
			).toBe("tabular-nums");
			await page.getByRole("button", { name: "Invite member" }).click();
			await pending.click();
			expect(await pending.getAttribute("aria-selected")).toBe("true");
			expect(await page.getByRole("tabpanel").innerText()).toBe(
				"Invite list (1)",
			);
			await page.keyboard.press("ArrowLeft");
			expect(await members.getAttribute("aria-selected")).toBe("true");
			await page.keyboard.press("ArrowRight");
			expect(await pending.getAttribute("aria-selected")).toBe("true");
			await page.getByRole("button", { name: "Invite member" }).click();
			expect(await page.getByRole("tabpanel").innerText()).toBe(
				"Invite list (2)",
			);
			await page.getByRole("tab", { name: "Disabled" }).click({ force: true });
			expect(await pending.getAttribute("aria-selected")).toBe("true");
			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "reduce",
			});
			await members.click();
			const indicator = page.locator('[data-slot="tabs-indicator"]');
			expect(
				await indicator.getAttribute("data-activation-direction"),
			).not.toBe("none");
			expect(
				await indicator.evaluate((node) =>
					getComputedStyle(node)
						.transitionDuration.split(", ")
						.every((value) => value === "0s"),
				),
			).toBe(true);
			expect(
				await members.evaluate(
					(node) => getComputedStyle(node).forcedColorAdjust,
				),
			).toBe("none");
			expect(
				await members.evaluate(
					(node) => getComputedStyle(node).transitionDuration,
				),
			).toBe("0s");
			const agentResult = await page.evaluate(async () => {
				const agent = Reflect.get(window, "tabsAgent") as {
					snapshot(): Array<{ component: string; ref: string }>;
					act(input: {
						steps: Array<{ action: string; args: string[]; ref: string }>;
					}): Promise<{ ok: boolean }>;
				};
				const tabs = agent
					.snapshot()
					.find(({ component }) => component === "tabs");
				if (!tabs) throw new Error("Tabs missing from agent snapshot");
				return agent.act({
					steps: [{ action: "setValue", args: ["pending"], ref: tabs.ref }],
				});
			});
			expect(agentResult.ok).toBe(true);
			expect(await pending.getAttribute("aria-selected")).toBe("true");
			expect(await page.locator("body").getAttribute("data-tabs-source")).toBe(
				"agent",
			);
			await page.setViewportSize({ width: 220, height: 480 });
			const list = page.getByRole("tablist", { name: "Workspace access" });
			expect(
				await list.evaluate((node) => node.scrollWidth > node.clientWidth),
			).toBe(true);
			await members.focus();
			await page.keyboard.press("End");
			const history = page.getByRole("tab", {
				name: "Invitation history",
				selected: true,
			});
			await history.waitFor();
			const area = await list.boundingBox();
			const tab = await history.boundingBox();
			if (!(area && tab)) throw new Error("Missing visible tab geometry");
			expect(tab.x + tab.width).toBeLessThanOrEqual(area.x + area.width);
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
