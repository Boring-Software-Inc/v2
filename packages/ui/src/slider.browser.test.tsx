import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

test("slider snaps, commits, submits, and announces declared values", async () => {
	const directory = await mkdtemp(join(tmpdir(), "tripwire-slider-"));
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
			import { createAgent } from ${JSON.stringify(join(root, "node_modules/@ui-sdk/react/dist/agent.js"))};
			import { createElement as h } from ${JSON.stringify(join(root, "node_modules/react/index.js"))};
			import { createRoot } from ${JSON.stringify(join(root, "node_modules/react-dom/client.js"))};
			import { Slider, StepSlider } from ${JSON.stringify(join(root, "packages/ui/src/slider.tsx"))};
			const commits = document.querySelector("#commits");
			const save = (value, details) => { commits.textContent += value + ":" + details.source + ";"; };
			const change = (value, details) => { document.querySelector("#change").textContent = value + ":" + details.source; };
			window.agent = createAgent({ allow: () => true });
			window.setSlider = async (label, value) => {
				const rows = window.agent.snapshot().filter((entry) => (entry.component === "slider" || entry.component === "step-slider") && entry.label === label);
				if (rows.length !== 1) throw new Error("Expected one agent slider: " + label);
				const [row] = rows;
				if (label === "Policy" && (!row.items?.some((item) => item.value === "7" && item.label === "Limited") || row.value === 1)) {
					throw new Error("Agent snapshot must expose declared stops");
				}
				return (await window.agent.act({steps:[{action:"setValue",args:[value],ref:row.ref}]})).ok;
			};
			createRoot(document.querySelector("#app")).render(h("form", { id: "controls" },
				h(Slider, {ariaLabel:"Volume", name:"volume", defaultValue:20, step:10, onValueCommit:save, onValueChange:change}),
				h(StepSlider, {ariaLabel:"Policy", steps:[{value:2,label:"Open"},{value:7,label:"Limited"},{value:20,label:"Strict"}], onValueCommit:save, onValueChange:change}),
				h(StepSlider, {ariaLabel:"Compact policy", showTickLabels:false, steps:[{ label: "Nothing hidden", value: 0 }, { label: "File paths hidden", value: 1 }, { label: "Verdict only", value: 2 }], defaultValue:1}),
				h(Slider, {ariaLabel:"Locked", readOnly:true, defaultValue:20}),
				h(Slider, {ariaLabel:"Disabled", disabled:true, defaultValue:40}),
				h(Slider, {ariaLabel:"Controlled", value:30}),
			));
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
		if (!(js && css)) throw new Error("Slider fixture did not bundle");
		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
		});
		try {
			const page = await browser.newPage();
			page.setDefaultTimeout(2_000);
			await page.route("**/*", (route) => {
				const path = new URL(route.request().url()).pathname;
				return path === "/client.js"
					? route.fulfill({ body: js, contentType: "text/javascript" })
					: path === "/"
						? route.fulfill({
								contentType: "text/html",
								body: `<style>${css}</style><body class="tripwire" data-system="tripwire"><div id="app"></div><output id="commits"></output><output id="change"></output><script type="module" src="/client.js"></script>`,
							})
						: route.abort();
			});
			await page.goto("http://slider.test/");
			const compact = page.getByRole("slider", { name: "Compact policy" });
			const compactRail = compact.locator(
				'xpath=ancestor::*[@data-slot="step-slider"]',
			);
			expect(await compact.getAttribute("aria-valuetext")).toBe(
				"File paths hidden",
			);
			expect(
				await compactRail.locator('[data-slot="slider-tick"]').count(),
			).toBe(0);
			expect(await compactRail.locator("[data-major]").count()).toBe(3);
			expect(
				await compactRail
					.locator('[data-slot="step-slider-stop"]:has([data-current])')
					.evaluate((node) => getComputedStyle(node).visibility),
			).toBe("hidden");
			const stepped = page.getByRole("slider", { name: "Policy", exact: true });
			const steppedRail = stepped.locator(
				'xpath=ancestor::*[@data-slot="step-slider"]',
			);
			await stepped.press("ArrowRight");
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Limited");
			const sweeps = steppedRail.locator('[data-slot="step-slider-sweep"]');
			const sweep = sweeps.first();
			const sweepNode = await sweep.elementHandle();
			if (!sweepNode) throw new Error("Missing sweep band");
			await page.waitForFunction((node) => {
				const animation = node.getAnimations()[0];
				if (!animation) return false;
				animation.pause();
				Reflect.set(node, "testSweep", animation);
				return true;
			}, sweepNode);
			await stepped.press("End");
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Strict");
			expect(
				await sweep.evaluate(
					(node) => node.getAnimations()[0] === Reflect.get(node, "testSweep"),
				),
			).toBe(true);
			await sweep.evaluate((node) => {
				const animation = node.getAnimations()[0];
				if (animation) animation.currentTime = 800;
			});
			await stepped.press("ArrowLeft");
			await sweeps.last().evaluate(async (node) => {
				await new Promise(requestAnimationFrame);
				if (!node.getAnimations().length)
					throw new Error("Late input did not start the alternate sweep");
			});
			await stepped.press("End");
			const fill = steppedRail.locator('[data-slot="step-slider-fill"]');
			const geometry = await fill.evaluate(async (node) => {
				const slider = node.closest('[data-slot="slider"]');
				const rail = slider?.querySelector('[data-slot="slider-control"]');
				const thumb = slider?.querySelector('[data-slot="slider-thumb"]');
				if (!(rail && thumb)) throw new Error("Missing stepped slider parts");
				await Promise.allSettled(
					[
						...thumb.getAnimations(),
						...(node.parentElement?.getAnimations() ?? []),
					].map((animation) => animation.finished),
				);
				const rect = node.getBoundingClientRect();
				const thumbRect = thumb.getBoundingClientRect();
				const style = getComputedStyle(node);
				return {
					startInset: Math.round(rect.left - rail.getBoundingClientRect().left),
					endFromThumbCenter: Math.round(
						rect.right - (thumbRect.left + thumbRect.width / 2),
					),
					topEndRadius: style.borderTopRightRadius,
					bottomEndRadius: style.borderBottomRightRadius,
				};
			});
			expect(geometry).toEqual({
				startInset: 4,
				endFromThumbCenter: 0,
				topEndRadius: "0px",
				bottomEndRadius: "0px",
			});
			expect(
				await page
					.getByText("Limited", { exact: true })
					.evaluate((node) => (node as HTMLElement).style.insetInlineStart),
			).toBe("50%");
			expect(
				await steppedRail
					.locator('[data-slot="step-slider-stop"]:has([data-filled])')
					.count(),
			).toBe(2);
			expect(await page.locator("#commits").textContent()).toBe(
				"7:keyboard;20:keyboard;7:keyboard;20:keyboard;",
			);
			const volume = page.getByRole("slider", { name: "Volume" });
			const track = volume.locator(
				'xpath=ancestor::*[@data-slot="slider-track"]',
			);
			const bounds = await track.boundingBox();
			if (!bounds) throw new Error("Missing slider track");
			const { x, y, width, height } = bounds;
			await page.mouse.move(x + width * 0.2, y + height / 2);
			await page.mouse.down();
			await page.mouse.move(x + width * 0.8, y + height / 2, { steps: 5 });
			await page.mouse.up();
			expect(await volume.inputValue()).toBe("80");
			expect(await page.locator("#commits").textContent()).toBe(
				"7:keyboard;20:keyboard;7:keyboard;20:keyboard;80:mouse;",
			);
			expect(
				await page
					.locator("form")
					.evaluate((node) =>
						new FormData(node as HTMLFormElement).get("volume"),
					),
			).toBe("80");
			await page
				.locator("form")
				.evaluate((node) => (node as HTMLFormElement).reset());
			await page.waitForFunction(
				() =>
					(
						document.querySelector(
							'input[name="volume"]',
						) as HTMLInputElement | null
					)?.value === "20",
			);
			expect(await volume.inputValue()).toBe("20");
			const locked = page.getByRole("slider", { name: "Locked" });
			await locked.press("End");
			expect(await locked.inputValue()).toBe("20");
			expect(
				await locked
					.locator('xpath=ancestor::*[@data-slot="slider-thumb"]')
					.evaluate((node) => getComputedStyle(node).outlineStyle),
			).toBe("solid");
			expect(
				await page.getByRole("slider", { name: "Disabled" }).isDisabled(),
			).toBe(true);
			const controlled = page.getByRole("slider", { name: "Controlled" });
			await controlled.press("End");
			expect(await controlled.inputValue()).toBe("30");
			const agentSet = (label: string, value: number) =>
				page.evaluate(
					([target, next]) =>
						(
							window as unknown as Window & {
								setSlider(label: string, value: number): Promise<boolean>;
							}
						).setSlider(target, next),
					[label, value] as const,
				);
			expect(await agentSet("Volume", 60)).toBe(true);
			expect(await volume.inputValue()).toBe("60");
			expect(await page.locator("#change").textContent()).toBe("60:agent");
			expect(await agentSet("Policy", 7)).toBe(true);
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Limited");
			expect(await page.locator("#change").textContent()).toBe("7:agent");
			expect(await agentSet("Policy", 1)).toBe(false);
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Limited");
			await stepped.press("Home");
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Open");
			await stepped.press("PageUp");
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Strict");
			await page
				.locator("body")
				.evaluate((node) => node.setAttribute("dir", "rtl"));
			await stepped.press("ArrowRight");
			expect(await stepped.getAttribute("aria-valuetext")).toBe("Limited");
			await page
				.locator("body")
				.evaluate((node) => node.setAttribute("dir", "ltr"));
			await agentSet("Locked", 90);
			expect(await locked.inputValue()).toBe("20");
			await agentSet("Disabled", 90);
			expect(
				await page.getByRole("slider", { name: "Disabled" }).inputValue(),
			).toBe("40");
			expect(
				await track.evaluate((node) => node.getBoundingClientRect().height),
			).toBe(4);
			expect(
				await stepped
					.locator('xpath=ancestor::*[@data-slot="slider-thumb"]')
					.evaluate((node) => node.getBoundingClientRect().width),
			).toBe(32);
			await page.emulateMedia({
				forcedColors: "active",
				reducedMotion: "reduce",
			});
			expect(
				await page
					.getByRole("slider", { name: "Disabled" })
					.locator('xpath=ancestor::*[@data-slot="slider-thumb"]')
					.evaluate((node) => {
						const sample = document.createElement("span");
						sample.style.color = "GrayText";
						sample.style.forcedColorAdjust = "none";
						document.body.append(sample);
						const expected = getComputedStyle(sample).color;
						sample.remove();
						return getComputedStyle(node).backgroundColor === expected;
					}),
			).toBe(true);
			expect(
				await steppedRail
					.locator('[data-slot="step-slider-sweep"]')
					.first()
					.evaluate((node) => getComputedStyle(node).display),
			).toBe("none");
			expect(
				await track.evaluate((node) => getComputedStyle(node).outlineStyle),
			).toBe("solid");
		} finally {
			await browser.close();
		}
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
