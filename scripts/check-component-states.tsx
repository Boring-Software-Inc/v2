import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "../apps/web/src/components/glaze/ui/button";
import {
	Field,
	FieldError,
	FieldLabel,
} from "../apps/web/src/components/glaze/ui/field";
import { Input } from "../apps/web/src/components/glaze/ui/input";

const markup = renderToStaticMarkup(
	<main style={{ display: "grid", gap: 24, padding: 32, width: 640 }}>
		<section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
			<Button id="button-rest" variant="ghost">
				Rest
			</Button>
			<Button data-force-hover id="button-hover" variant="ghost">
				Hover
			</Button>
			<Button data-force-active id="button-pressed" variant="ghost">
				Pressed
			</Button>
			<Button data-popup-open id="button-open" variant="ghost">
				Open
			</Button>
			<Button disabled id="button-disabled" variant="ghost">
				Disabled
			</Button>
			<Button id="button-pending" pending pendingLabel="Saving">
				Save
			</Button>
			<div data-force-reduced-motion>
				<Button data-force-active id="button-reduced" variant="ghost">
					Reduced
				</Button>
			</div>
		</section>
		<Field id="field-rest">
			<FieldLabel>Resting field</FieldLabel>
			<Input defaultValue="Rest" />
		</Field>
		<Field id="field-focus">
			<FieldLabel>Focused field</FieldLabel>
			<Input data-force-focus defaultValue="Focus" />
		</Field>
		<Field id="field-invalid" invalid>
			<FieldLabel>Invalid field</FieldLabel>
			<Input defaultValue="Invalid" />
			<FieldError>Fix this value.</FieldError>
		</Field>
		<Field disabled id="field-disabled">
			<FieldLabel>Disabled field</FieldLabel>
			<Input defaultValue="Disabled" />
		</Field>
		<div className="overlay" id="overlay-state" style={{ minHeight: 48 }}>
			Overlay
		</div>
		<div
			className="feedback-selection-outline"
			id="feedback-selection"
			style={{ height: 48, width: 160 }}
		/>
	</main>,
);

const executablePath =
	"/home/grim/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
function parseColor(value: string) {
	if (value.startsWith("#")) {
		const hex = value.slice(1);
		const full =
			hex.length === 3
				? [...hex].map((part) => `${part}${part}`).join("")
				: hex;
		return {
			r: Number.parseInt(full.slice(0, 2), 16),
			g: Number.parseInt(full.slice(2, 4), 16),
			b: Number.parseInt(full.slice(4, 6), 16),
			a: 1,
		};
	}
	const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
	return {
		r: channels[0] ?? 0,
		g: channels[1] ?? 0,
		b: channels[2] ?? 0,
		a: channels[3] ?? 1,
	};
}

function contrast(foreground: string, background: string) {
	const front = parseColor(foreground);
	const back = parseColor(background);
	const mixed = {
		r: front.r * front.a + back.r * (1 - front.a),
		g: front.g * front.a + back.g * (1 - front.a),
		b: front.b * front.a + back.b * (1 - front.a),
	};
	const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
		const linear = (channel: number) => {
			const value = channel / 255;
			return value <= 0.03928
				? value / 12.92
				: ((value + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
	};
	const a = luminance(mixed);
	const b = luminance(back);
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const browser = await chromium.launch({ executablePath, headless: true });
const reports: Record<string, unknown> = {};
await mkdir(".design-system/state-matrix", { recursive: true });

for (const theme of ["light", "dark"] as const) {
	const context = await browser.newContext({
		viewport: { width: 800, height: 900 },
	});
	const page = await context.newPage();
	await page.goto("http://localhost:3000/login", {
		waitUntil: "domcontentloaded",
	});
	await page.setContent(`<!doctype html><html class="${theme === "dark" ? "dark" : ""}" data-theme="${theme}"><head>
		<link rel="stylesheet" href="http://localhost:3000/src/styles.css">
		<link rel="stylesheet" href="http://localhost:3000/src/components/glaze/styles.css">
		<link rel="stylesheet" href="http://localhost:3000/src/design-system/color-contract.css">
	</head><body class="glaze">${markup}</body></html>`);
	await page.waitForFunction(
		() =>
			getComputedStyle(document.body)
				.getPropertyValue("--tw-content-primary")
				.trim() !== "",
	);
	await page.locator("#button-rest").focus();
	const buttonFocus = await page.locator("#button-rest").evaluate((element) => {
		const style = getComputedStyle(element);
		return {
			outlineColor: style.outlineColor,
			outlineStyle: style.outlineStyle,
			outlineWidth: style.outlineWidth,
		};
	});
	await page.locator('#field-focus [data-slot="input-control"]').focus();
	const state = await page.evaluate((focusedButton) => {
		const styleOf = (selector: string) => {
			const element = document.querySelector<HTMLElement>(selector);
			if (!element) throw new Error(`missing ${selector}`);
			const style = getComputedStyle(element);
			return {
				backgroundColor: style.backgroundColor,
				borderColor: style.borderColor,
				boxShadow: style.boxShadow,
				color: style.color,
				cursor: style.cursor,
				outlineColor: style.outlineColor,
				outlineStyle: style.outlineStyle,
				outlineWidth: style.outlineWidth,
				scale: style.scale,
				transitionDuration: style.transitionDuration,
			};
		};
		const inputBox = (field: string) => styleOf(`${field} [data-slot="input"]`);
		return {
			semanticVariables: [
				"--tw-content-primary",
				"--tw-content-secondary",
				"--tw-boundary-focus",
				"--tw-boundary-feedback-inner",
				"--tw-boundary-feedback-outer",
				"--tw-danger-text",
			].map((name) => [
				name,
				getComputedStyle(document.body).getPropertyValue(name).trim(),
			]),
			button: {
				rest: styleOf("#button-rest"),
				focus: focusedButton,
				hover: styleOf("#button-hover"),
				pressed: styleOf("#button-pressed"),
				open: styleOf("#button-open"),
				disabled: styleOf("#button-disabled"),
				pending: {
					...styleOf("#button-pending"),
					ariaBusy: document
						.querySelector("#button-pending")
						?.getAttribute("aria-busy"),
				},
				reduced: styleOf("#button-reduced"),
			},
			field: {
				rest: inputBox("#field-rest"),
				focus: inputBox("#field-focus"),
				invalid: inputBox("#field-invalid"),
				disabled: inputBox("#field-disabled"),
			},
			overlay: styleOf("#overlay-state"),
			feedback: styleOf("#feedback-selection"),
			pageBackground: getComputedStyle(document.body).backgroundColor,
		};
	}, buttonFocus);

	const typed = state as {
		semanticVariables: [string, string][];
		button: Record<string, Record<string, string | null>>;
		field: Record<string, Record<string, string>>;
		overlay: Record<string, string>;
		feedback: Record<string, string>;
		pageBackground: string;
	};
	const failures: string[] = [];
	const differs = (
		a: Record<string, unknown>,
		b: Record<string, unknown>,
		keys: string[],
	) => keys.some((key) => a[key] !== b[key]);
	if (typed.semanticVariables.some(([, value]) => !value))
		failures.push("empty semantic color variable");
	const variables = Object.fromEntries(typed.semanticVariables);
	if (
		contrast(variables["--tw-boundary-focus"] ?? "", typed.pageBackground) < 3
	)
		failures.push("focus contrast below 3:1");
	if (
		contrast(
			variables["--tw-boundary-feedback-inner"] ?? "",
			variables["--tw-boundary-feedback-outer"] ?? "",
		) < 7
	)
		failures.push("feedback dual-tone contrast below 7:1");
	if (!differs(typed.button.rest, typed.button.hover, ["backgroundColor"]))
		failures.push("button hover invisible");
	if (
		!differs(typed.button.rest, typed.button.pressed, [
			"backgroundColor",
			"scale",
		])
	)
		failures.push("button press invisible");
	if (!differs(typed.button.rest, typed.button.open, ["backgroundColor"]))
		failures.push("button open invisible");
	if (!differs(typed.button.rest, typed.button.disabled, ["color", "cursor"]))
		failures.push("button disabled invisible");
	if (
		typed.button.pending.ariaBusy !== "true" ||
		typed.button.pending.cursor !== "progress"
	)
		failures.push("button pending contract missing");
	if (typed.button.reduced.transitionDuration !== "0s")
		failures.push("reduced motion transition remains");
	if (Number.parseFloat(String(typed.button.focus.outlineWidth)) < 2)
		failures.push("focus outline too thin");
	if (
		!differs(typed.field.rest, typed.field.focus, ["borderColor", "boxShadow"])
	)
		failures.push("field focus invisible");
	if (
		!differs(typed.field.rest, typed.field.invalid, [
			"borderColor",
			"boxShadow",
		])
	)
		failures.push("field invalid invisible");
	if (
		!differs(typed.field.rest, typed.field.disabled, [
			"backgroundColor",
			"color",
			"cursor",
		])
	)
		failures.push("field disabled invisible");
	if (
		typed.overlay.backgroundColor === "rgba(0, 0, 0, 0)" ||
		typed.overlay.borderColor === "rgba(0, 0, 0, 0)"
	)
		failures.push("overlay surface missing");
	if (
		Number.parseFloat(typed.feedback.outlineWidth) < 2 ||
		typed.feedback.boxShadow === "none"
	)
		failures.push("feedback selection invisible");

	reports[theme] = { state, failures };
	await page.screenshot({
		path: `.design-system/state-matrix/component-states-${theme}.png`,
	});
	await context.close();
}

await browser.close();
console.log(JSON.stringify(reports, null, 2));
if (
	Object.values(reports).some(
		(report) => (report as { failures: string[] }).failures.length > 0,
	)
) {
	process.exitCode = 1;
}
