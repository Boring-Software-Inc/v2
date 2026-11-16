import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { JsonValue } from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import {
	Field,
	FieldError,
	FieldLabel,
	Input,
	Textarea,
} from "@tripwire/ui/field";
import { Select } from "@tripwire/ui/select";
import { chromium } from "playwright-core";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer, type ViteDevServer } from "vite";

const markup = renderToStaticMarkup(
	<main style={{ display: "grid", gap: 24, padding: 32, width: 640 }}>
		<section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
			<div id="button-small">
				<Button size="small">Small</Button>
			</div>
			<div id="button-rest">
				<Button variant="ghost">Rest</Button>
			</div>
			<div id="button-large">
				<Button size="large">Large</Button>
			</div>
			<div id="button-primary">
				<Button variant="primary">Primary</Button>
			</div>
			<div id="button-destructive">
				<Button
					confirmation={{ title: "Remove fixture?" }}
					onAction={() => undefined}
					variant="destructive"
				>
					Remove
				</Button>
			</div>
			<div id="button-hover">
				<Button variant="ghost">Hover</Button>
			</div>
			<div id="button-pressed">
				<Button variant="ghost">Pressed</Button>
			</div>
			<div id="button-open">
				<Button variant="ghost">Open</Button>
			</div>
			<div id="button-disabled">
				<Button disabled variant="ghost">
					Disabled
				</Button>
			</div>
			<div id="button-pending">
				<Button pending pendingLabel="Saving">
					Save
				</Button>
			</div>
			<div data-force-reduced-motion>
				<div id="button-reduced">
					<Button variant="ghost">Reduced</Button>
				</div>
			</div>
		</section>
		<div id="field-rest">
			<Field>
				<FieldLabel>Resting field</FieldLabel>
				<Input defaultValue="Rest" />
			</Field>
		</div>
		<div id="textarea-shapes">
			<Textarea ariaLabel="Short note" rows={2} />
			<Textarea ariaLabel="Long note" rows={6} />
		</div>
		<div id="select-shapes">
			<Select ariaLabel="Native shape" mode="native" options={[]} />
			<Select ariaLabel="Popup shape" options={[]} />
		</div>
		<div id="field-focus">
			<Field>
				<FieldLabel>Focused field</FieldLabel>
				<Input defaultValue="Focus" />
			</Field>
		</div>
		<div id="field-invalid">
			<Field invalid>
				<FieldLabel>Invalid field</FieldLabel>
				<Input defaultValue="Invalid" />
				<FieldError>Fix this value.</FieldError>
			</Field>
		</div>
		<div id="field-disabled">
			<Field disabled>
				<FieldLabel>Disabled field</FieldLabel>
				<Input defaultValue="Disabled" />
			</Field>
		</div>
		<section aria-label="Overlay contracts" id="overlay-contracts">
			<div data-slot="dialog-backdrop" id="dialog-backdrop-state" />
			<div data-slot="alert-dialog-backdrop" id="alert-backdrop-state" />
			<div data-size="medium" data-slot="dialog-content" id="dialog-state">
				<header data-slot="dialog-header">
					<div data-slot="dialog-heading">
						<h2 data-slot="dialog-title">Dialog title</h2>
						<p data-slot="dialog-description">Dialog description</p>
					</div>
				</header>
				<div data-slot="dialog-body">Dialog body</div>
			</div>
			<div
				data-slot="dialog-content"
				data-starting-style=""
				id="dialog-entering-state"
			/>
			<div data-side="bottom" data-slot="popover-content" id="popover-state">
				Popover
			</div>
			<div
				data-side="bottom"
				data-slot="popover-content"
				data-starting-style=""
				id="popover-entering-state"
			/>
			<div data-slot="menu-content" id="menu-state">
				<div data-slot="menu-item">Menu item</div>
			</div>
			<div data-force-reduced-motion="">
				<div data-slot="popover-content" id="popover-reduced-state" />
			</div>
		</section>
		<div className="overlay" id="overlay-state" style={{ minHeight: 48 }}>
			Overlay
		</div>
		<div
			className="feedback-selection-outline"
			id="feedback-selection"
			style={{ height: 48, width: 160 }}
		/>
		<section aria-label="Sidebar icon rhythm" id="sidebar-icon-rhythm">
			<nav
				aria-label="Collapsed shell geometry"
				data-collapsed="true"
				data-layout-role="dashboard-rail"
				id="sidebar-rail-collapsed"
			/>
			<a
				aria-label="Tripwire home"
				data-layout-role="sidebar-brand-link"
				href="/"
				id="sidebar-brand-link"
			>
				Tripwire
			</a>
			<span
				data-layout-role="sidebar-nav-icon-plate"
				id="sidebar-icon-expanded"
			>
				<span data-layout-role="sidebar-nav-icon">
					<svg aria-hidden="true" viewBox="0 0 16 16">
						<circle cx="8" cy="8" r="6" />
					</svg>
				</span>
			</span>
			<span
				data-collapsed="true"
				data-layout-role="sidebar-nav-icon-plate"
				id="sidebar-icon-collapsed"
			>
				<span data-layout-role="sidebar-nav-icon">
					<svg aria-hidden="true" viewBox="0 0 16 16">
						<circle cx="8" cy="8" r="6" />
					</svg>
				</span>
			</span>
			<span data-layout-role="sidebar-search-icon" id="sidebar-search-expanded">
				<svg aria-hidden="true" data-slot="icon" viewBox="0 0 16 16">
					<circle cx="8" cy="8" r="6" />
				</svg>
			</span>
			<button data-size="small" data-slot="button" type="button">
				<span
					data-layout-role="sidebar-search-icon"
					id="sidebar-search-collapsed"
				>
					<svg aria-hidden="true" data-slot="icon" viewBox="0 0 16 16">
						<circle cx="8" cy="8" r="6" />
					</svg>
				</span>
			</button>
		</section>
	</main>,
);

const STYLE_SERVER_ORIGIN = "http://127.0.0.1:3001";
let styleServer: ViteDevServer | undefined;

async function styleServerIsReady() {
	try {
		const response = await fetch(STYLE_SERVER_ORIGIN);
		return response.status < 500;
	} catch {
		return false;
	}
}

if (!(await styleServerIsReady())) {
	styleServer = await createServer({
		logLevel: "error",
		plugins: [tailwindcss()],
		server: { host: "127.0.0.1", port: 3001, strictPort: true },
	});
	await styleServer.listen();
}

process.on("exit", () => void styleServer?.close());

const uiStyleHrefs = [
	"tripwire.css",
	"color.css",
	"components.css",
	"presentational.css",
].map(
	(file) =>
		`${STYLE_SERVER_ORIGIN}/@fs${resolve(`packages/ui/src/styles/${file}`)}?direct`,
);
uiStyleHrefs.push(
	`${STYLE_SERVER_ORIGIN}/@fs${resolve("apps/web/src/design-system/layout-contract.css")}?direct`,
);
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

function contrast(foreground: string, background: string, surface?: string) {
	const front = parseColor(foreground);
	const base = parseColor(background);
	const under = surface ? parseColor(surface) : base;
	const back = {
		r: base.r * base.a + under.r * (1 - base.a),
		g: base.g * base.a + under.g * (1 - base.a),
		b: base.b * base.a + under.b * (1 - base.a),
	};
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

const browser = await chromium.launch({ headless: true });
const reports: Record<string, { state: JsonValue; failures: string[] }> = {};
await mkdir(".design-system/state-matrix", { recursive: true });
const stateHostPath = resolve(".design-system/state-matrix/host.html");
await writeFile(stateHostPath, "<!doctype html><html><body></body></html>");
const behaviorHostPath = resolve(
	".design-system/state-matrix/behavior-host.html",
);
const behaviorEntryPath = resolve(
	".design-system/state-matrix/behavior-host.tsx",
);
await writeFile(
	behaviorHostPath,
	`<!doctype html><html><head>${uiStyleHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}</head><body class="tripwire"><div id="root"></div><script type="module" src="/@fs${behaviorEntryPath}"></script></body></html>`,
);
await writeFile(
	behaviorEntryPath,
	`import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { Tabs } from "/@fs${resolve("packages/ui/src/tabs.tsx")}";
import { Toolbar } from "/@fs${resolve("packages/ui/src/toolbar.tsx")}";
import { Avatar, AvatarGroup } from "/@fs${resolve("packages/ui/src/avatar.tsx")}";
import { Badge } from "/@fs${resolve("packages/ui/src/badge.tsx")}";
import { Check, Icon, Pending } from "/@fs${resolve("packages/ui/src/icon.tsx")}";
import { Progress } from "/@fs${resolve("packages/ui/src/progress.tsx")}";

function ReviewerAvatar() {
  const [broken, setBroken] = useState(false);
  return createElement(Avatar, {
    name: "Demo reviewer",
    src: broken ? "/missing-avatar.png" : "/test-avatar.svg",
    onClick: () => setBroken(!broken),
  });
}

createRoot(document.getElementById("root")).render(createElement("main", null,
createElement("section", { id: "feedback-fixture" },
  createElement(Avatar, { name: "Demo owner", src: "/missing-avatar.png" }),
  createElement(ReviewerAvatar),
  createElement(Progress, { label: "Importing changes", value: 12, max: 35, valueText: "12 of 35" }),
  createElement(Progress, { label: "Loading page", showHeader: false, size: "compact", value: null })),
createElement("section", { id: "badge-icon-fixture" },
  ...["medium", "small"].map(size => createElement("div", { key: size },
    ...["neutral", "info", "success", "warning", "danger"].map((tone, index) =>
      createElement(Badge, { key: tone, size, tone },
        createElement(Icon, { icon: Check }), ["Default", "Info", "Passed", "Waiting", "Blocked"][index])),
    createElement(Badge, { size, variant: "outline" }, "Draft"))),
  createElement("div", null,
    ...[12, 14, 16, 18, 20, 24, 32, 40].map(size => createElement(Icon, { key: size, icon: Check, size })),
    createElement(Icon, { icon: Check, label: "   " }),
    createElement(Icon, { icon: Pending, label: " Loading ", motion: "spin", size: 20 }))),
createElement("section", { id: "avatar-group-fixture" },
  ...["xs", "sm", "default", "lg"].map(size => createElement(AvatarGroup, {
    key: size, label: size + " reviewers", size, max: 3,
  }, ...["Sam Okafor", "Rin Takeda", "Demo agent", "Source catalog"].map((name, index) =>
    createElement(Avatar, { key: name, name, size, type: index === 1 ? "agent" : "person" })))),
  createElement(Avatar, { name: "Source catalog", type: "source" })),
createElement("section", { id: "progress-edge-fixture" },
  createElement(Progress, { label: "Just started", showHeader: false, value: 1, max: 10000 }),
  createElement(Progress, { label: "Not started", showHeader: false, value: 0 })),
createElement(Tabs, {
  ariaLabel: "Workspace access",
  defaultValue: "members",
  items: [
    { label: "Members", value: "members" },
    { label: "Pending", value: "pending" },
    { disabled: true, label: "Archived", value: "archived" },
  ],
  panelMode: "external",
  size: "small",
}), ...["horizontal", "vertical"].map((orientation) =>
  createElement(Toolbar, {
    key: orientation,
    ariaLabel: orientation + " tools",
    orientation,
    items: [
      { type: "action", value: "refresh", label: "Refresh", onAction: ({ source }) => { document.body.dataset.action = source; } },
      { type: "action", value: "disabled", label: "Unavailable", disabled: true, onAction: () => { document.body.dataset.action = "unexpected"; } },
      { type: "separator", value: "divider" },
      { type: "link", value: "help", label: "Help", href: "#help" },
    ],
  })), createElement("button", { type: "button" }, "After toolbars")));
`,
);

for (const theme of ["light", "dark"] as const) {
	const context = await browser.newContext({
		reducedMotion: "no-preference",
		viewport: { width: 800, height: 900 },
	});
	const page = await context.newPage();
	await page.goto(`${STYLE_SERVER_ORIGIN}/@fs${stateHostPath}`, {
		waitUntil: "domcontentloaded",
	});
	await page.setContent(`<!doctype html><html class="${theme === "dark" ? "dark" : ""}" data-theme="${theme}"><head>
		${uiStyleHrefs.map((href) => `<link rel="stylesheet" href="${href}">`).join("")}
	</head><body class="tripwire">${markup}</body></html>`);
	await page.waitForFunction(
		() =>
			document.styleSheets.length >= 5 &&
			getComputedStyle(document.body)
				.getPropertyValue("--tw-content-primary")
				.trim() !== "",
	);
	await page.evaluate(() => {
		document
			.querySelector("#button-hover [data-slot='button']")
			?.setAttribute("data-force-hover", "");
		document
			.querySelector("#button-pressed [data-slot='button']")
			?.setAttribute("data-force-active", "");
		document
			.querySelector("#button-open [data-slot='button']")
			?.setAttribute("data-popup-open", "");
		document
			.querySelector("#button-reduced [data-slot='button']")
			?.setAttribute("data-force-active", "");
	});
	await page.waitForTimeout(250);
	const sidebarRail = page.locator("#sidebar-rail-collapsed");
	await sidebarRail.evaluate((element) =>
		element.removeAttribute("data-collapsed"),
	);
	const sidebarExpansionWidths: number[] = [];
	for (let frame = 0; frame < 16; frame += 1) {
		sidebarExpansionWidths.push(
			await sidebarRail.evaluate(
				(element) => element.getBoundingClientRect().width,
			),
		);
		await page.waitForTimeout(16);
	}
	await sidebarRail.evaluate((element) =>
		element.setAttribute("data-collapsed", "true"),
	);
	await page.waitForTimeout(250);
	await page.locator("#button-rest [data-slot='button']").focus();
	const buttonFocus = await page
		.locator("#button-rest [data-slot='button']")
		.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				outlineColor: style.outlineColor,
				outlineStyle: style.outlineStyle,
				outlineWidth: style.outlineWidth,
			};
		});
	await page.locator('#field-focus [data-slot="input"]').focus();
	const measuredState = await page.evaluate((focusedButton) => {
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
				opacity: style.opacity,
				position: style.position,
				borderRadius: style.borderRadius,
				maxBlockSize: style.maxBlockSize,
				scale: style.scale,
				translate: style.translate,
				transform: style.transform,
				transitionDuration: style.transitionDuration,
			};
		};
		const glassOf = (variant: string) => {
			const element = document.querySelector(
				`#button-${variant} [data-slot=button]`,
			);
			if (!element) throw new Error(`Missing ${variant} button`);
			const style = getComputedStyle(element);
			return {
				background: style.backgroundColor,
				foreground: style.color,
				image: style.backgroundImage,
				shadow: style.boxShadow,
				blur: style.backdropFilter,
				rim: getComputedStyle(element, "::before").backgroundImage,
				catchLight: getComputedStyle(element, "::after").backgroundImage,
			};
		};
		const inputBox = (field: string) => styleOf(`${field} [data-slot="input"]`);
		const rectOf = (selector: string) => {
			const element = document.querySelector<HTMLElement>(selector);
			if (!element) throw new Error(`missing ${selector}`);
			const rect = element.getBoundingClientRect();
			return {
				height: rect.height,
				width: rect.width,
				x: rect.x,
				y: rect.y,
			};
		};
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
			controlSizes: {
				expected: {
					small: getComputedStyle(document.body)
						.getPropertyValue("--control-sm")
						.trim(),
					medium: getComputedStyle(document.body)
						.getPropertyValue("--control")
						.trim(),
					large: getComputedStyle(document.body)
						.getPropertyValue("--control-lg")
						.trim(),
				},
				actual: {
					small: document
						.querySelector<HTMLElement>("#button-small [data-slot='button']")
						?.getBoundingClientRect().height,
					medium: document
						.querySelector<HTMLElement>("#button-rest [data-slot='button']")
						?.getBoundingClientRect().height,
					large: document
						.querySelector<HTMLElement>("#button-large [data-slot='button']")
						?.getBoundingClientRect().height,
				},
			},
			button: {
				glass: {
					primary: glassOf("primary"),
					destructive: glassOf("destructive"),
				},
				rest: styleOf("#button-rest [data-slot='button']"),
				focus: focusedButton,
				hover: styleOf("#button-hover [data-slot='button']"),
				pressed: styleOf("#button-pressed [data-slot='button']"),
				open: styleOf("#button-open [data-slot='button']"),
				disabled: styleOf("#button-disabled [data-slot='button']"),
				pending: {
					...styleOf("#button-pending [data-slot='button']"),
					ariaBusy:
						document
							.querySelector("#button-pending [data-slot='button']")
							?.getAttribute("aria-busy") ?? null,
				},
				reduced: styleOf("#button-reduced [data-slot='button']"),
			},
			field: {
				rest: inputBox("#field-rest"),
				focus: inputBox("#field-focus"),
				invalid: inputBox("#field-invalid"),
				disabled: inputBox("#field-disabled"),
			},
			controlCorners: {
				pills: [
					styleOf("#button-small [data-slot='button']").borderRadius,
					inputBox("#field-rest").borderRadius,
					styleOf("#select-shapes [data-slot='select-native']").borderRadius,
					styleOf("#select-shapes [data-slot='select-trigger']").borderRadius,
				],
				multiline: [
					styleOf("#textarea-shapes textarea:first-child").borderRadius,
					styleOf("#textarea-shapes textarea:last-child").borderRadius,
				],
			},
			overlays: {
				alertBackdrop: styleOf("#alert-backdrop-state"),
				backdrop: styleOf("#dialog-backdrop-state"),
				dialog: {
					...styleOf("#dialog-state"),
					rect: rectOf("#dialog-state"),
				},
				dialogEntering: styleOf("#dialog-entering-state"),
				menu: styleOf("#menu-state"),
				popover: styleOf("#popover-state"),
				popoverEntering: styleOf("#popover-entering-state"),
				popoverReduced: styleOf("#popover-reduced-state"),
			},
			overlay: styleOf("#overlay-state"),
			feedback: styleOf("#feedback-selection"),
			sidebarIconRhythm: {
				brandHitArea: rectOf("#sidebar-brand-link"),
				collapsed: {
					icon: rectOf(
						'#sidebar-icon-collapsed [data-layout-role="sidebar-nav-icon"]',
					),
					plate: rectOf("#sidebar-icon-collapsed"),
					svg: rectOf("#sidebar-icon-collapsed svg"),
				},
				expanded: {
					icon: rectOf(
						'#sidebar-icon-expanded [data-layout-role="sidebar-nav-icon"]',
					),
					plate: rectOf("#sidebar-icon-expanded"),
					svg: rectOf("#sidebar-icon-expanded svg"),
				},
				rail: rectOf("#sidebar-rail-collapsed"),
				search: {
					collapsed: rectOf("#sidebar-search-collapsed svg"),
					expanded: rectOf("#sidebar-search-expanded svg"),
				},
			},
			pageBackground: getComputedStyle(document.body).backgroundColor,
		};
	}, buttonFocus);

	const state = {
		...measuredState,
		sidebarMotion: { expansionWidths: sidebarExpansionWidths },
	};
	const typed = state;
	const failures: string[] = [];
	if (typed.controlCorners.pills.some((radius) => radius !== "999px"))
		failures.push("one-line controls must use Glaze pill corners");
	if (typed.controlCorners.multiline.some((radius) => radius !== "10px"))
		failures.push("textareas must use the 10px Glaze multiline corner");
	const differs = (
		a: Record<string, string>,
		b: Record<string, string>,
		keys: string[],
	) => keys.some((key) => a[key] !== b[key]);
	if (typed.semanticVariables.some(([, value]) => !value))
		failures.push("empty semantic color variable");
	const variables = Object.fromEntries(typed.semanticVariables);
	const expectedControlSizes = Object.fromEntries(
		Object.entries(typed.controlSizes.expected).map(([size, value]) => [
			size,
			Number.parseFloat(value),
		]),
	);
	for (const size of ["small", "medium", "large"] as const) {
		if (typed.controlSizes.actual[size] !== expectedControlSizes[size]) {
			failures.push(`${size} button height does not match its control token`);
		}
	}
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
	for (const [variant, style] of Object.entries(typed.button.glass)) {
		if (
			!style.image.includes("gradient(") ||
			!style.shadow.includes("inset") ||
			!style.blur.startsWith("blur(") ||
			!style.rim.includes("gradient(") ||
			!style.catchLight.includes("gradient(")
		)
			failures.push(`${variant} button is missing its Glaze glass finish`);
		if (
			contrast(style.foreground, style.background, typed.pageBackground) < 4.5
		)
			failures.push(`${variant} button contrast below 4.5:1`);
	}
	if (!differs(typed.button.rest, typed.button.hover, ["backgroundColor"]))
		failures.push("button hover invisible");
	if (
		!differs(typed.button.rest, typed.button.pressed, [
			"backgroundColor",
			"transform",
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
	if (
		typed.button.reduced.transitionDuration
			.split(",")
			.some((duration) => duration.trim() !== "0s")
	)
		failures.push("reduced motion transition remains");
	if (Number.parseFloat(String(typed.button.focus.outlineWidth)) < 2)
		failures.push("focus outline too thin");
	if (
		!differs(typed.field.rest, typed.field.focus, [
			"borderColor",
			"boxShadow",
			"outlineColor",
			"outlineStyle",
			"outlineWidth",
		])
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
		typed.overlays.backdrop.position !== "fixed" ||
		typed.overlays.backdrop.backgroundColor === "rgba(0, 0, 0, 0)"
	)
		failures.push("dialog backdrop contract missing");
	if (
		typed.overlays.alertBackdrop.position !== "fixed" ||
		typed.overlays.alertBackdrop.backgroundColor === "rgba(0, 0, 0, 0)"
	)
		failures.push("alert dialog backdrop contract missing");
	if (
		typed.overlays.dialog.position !== "fixed" ||
		typed.overlays.dialog.backgroundColor === "rgba(0, 0, 0, 0)" ||
		typed.overlays.dialog.borderColor === "rgba(0, 0, 0, 0)"
	)
		failures.push("dialog surface contract missing");
	if (
		Math.abs(
			typed.overlays.dialog.rect.x + typed.overlays.dialog.rect.width / 2 - 400,
		) > 1 ||
		Math.abs(
			typed.overlays.dialog.rect.y +
				typed.overlays.dialog.rect.height / 2 -
				450,
		) > 1
	)
		failures.push("dialog is not centered in the viewport");
	if (
		typed.overlays.dialogEntering.opacity !== "0" ||
		typed.overlays.dialogEntering.transform === typed.overlays.dialog.transform
	)
		failures.push("dialog presence motion contract missing");
	if (
		typed.overlays.popoverEntering.opacity !== "0" ||
		typed.overlays.popoverEntering.translate ===
			typed.overlays.popover.translate ||
		typed.overlays.popoverEntering.scale !== typed.overlays.popover.scale
	)
		failures.push("popup presence motion contract missing");
	if (Number.parseFloat(typed.overlays.menu.maxBlockSize) !== 370)
		failures.push("popup maximum height drifted");
	if (
		typed.overlays.popoverReduced.transitionDuration
			.split(",")
			.some((duration) => duration.trim() !== "0s")
	)
		failures.push("popup reduced-motion contract missing");
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
	const expandedIcon = typed.sidebarIconRhythm.expanded;
	const collapsedIcon = typed.sidebarIconRhythm.collapsed;
	if (typed.sidebarIconRhythm.rail.width !== 50)
		failures.push("collapsed sidebar rail width drifted");
	if (
		typed.sidebarMotion.expansionWidths.some(
			(width, index, widths) =>
				width > 224.5 || (index > 0 && width < (widths[index - 1] ?? width)),
		) ||
		Math.abs((typed.sidebarMotion.expansionWidths.at(-1) ?? 0) - 224) > 0.5
	)
		failures.push("sidebar expansion overshot or reversed direction");
	if (
		typed.sidebarIconRhythm.brandHitArea.width !== 34 ||
		typed.sidebarIconRhythm.brandHitArea.height !== 34
	)
		failures.push("sidebar brand hit area drifted");
	if (
		expandedIcon.svg.width !== 16 ||
		expandedIcon.svg.height !== 16 ||
		collapsedIcon.svg.width !== 16 ||
		collapsedIcon.svg.height !== 16
	)
		failures.push("sidebar icon legibility size drifted");
	if (
		expandedIcon.icon.width !== collapsedIcon.icon.width ||
		expandedIcon.icon.height !== collapsedIcon.icon.height ||
		expandedIcon.svg.width !== collapsedIcon.svg.width ||
		expandedIcon.svg.height !== collapsedIcon.svg.height
	)
		failures.push("sidebar icon geometry differs by expansion state");
	for (const [stateName, iconState] of [
		["expanded", expandedIcon],
		["collapsed", collapsedIcon],
	] as const) {
		const plateCenterX = iconState.plate.x + iconState.plate.width / 2;
		const plateCenterY = iconState.plate.y + iconState.plate.height / 2;
		const svgCenterX = iconState.svg.x + iconState.svg.width / 2;
		const svgCenterY = iconState.svg.y + iconState.svg.height / 2;
		if (
			Math.abs(plateCenterX - svgCenterX) > 0.5 ||
			Math.abs(plateCenterY - svgCenterY) > 0.5
		)
			failures.push(`${stateName} sidebar icon is not optically centered`);
	}
	if (
		typed.sidebarIconRhythm.search.expanded.width !== 16 ||
		typed.sidebarIconRhythm.search.expanded.height !== 16 ||
		typed.sidebarIconRhythm.search.collapsed.width !== 16 ||
		typed.sidebarIconRhythm.search.collapsed.height !== 16
	)
		failures.push("sidebar search icon geometry differs by expansion state");

	reports[theme] = { state, failures };
	await page.screenshot({
		path: `.design-system/state-matrix/component-states-${theme}.png`,
	});
	await context.close();
}

const behaviorContext = await browser.newContext({
	viewport: { width: 640, height: 320 },
});
const behaviorPage = await behaviorContext.newPage();
await behaviorPage.route("**/test-avatar.svg", (route) =>
	route.fulfill({
		contentType: "image/svg+xml",
		body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="teal"/></svg>',
	}),
);
await behaviorPage.route("**/missing-avatar.png", (route) =>
	route.fulfill({ status: 404 }),
);
await behaviorPage.goto(`${STYLE_SERVER_ORIGIN}/@fs${behaviorHostPath}`, {
	waitUntil: "networkidle",
});
const membersTab = behaviorPage.getByRole("tab", { name: "Members" });
const pendingTab = behaviorPage.getByRole("tab", { name: "Pending" });
await membersTab.waitFor();
const feedback = behaviorPage.locator("#feedback-fixture");
const avatarGroups = behaviorPage.locator("#avatar-group-fixture");
const badgeIcons = behaviorPage.locator("#badge-icon-fixture");
const badgeIconFailures: string[] = [];
for (const width of [390, 1280]) {
	await behaviorPage.setViewportSize({ width, height: 480 });
	for (const theme of ["light", "dark"]) {
		await behaviorPage
			.locator("html")
			.evaluate(
				(element, activeTheme) =>
					element.setAttribute("data-theme", activeTheme),
				theme,
			);
		await feedback.screenshot({
			path: `.design-system/state-matrix/avatar-progress-${theme}-${width}.png`,
		});
		await avatarGroups.screenshot({
			path: `.design-system/state-matrix/avatar-group-${theme}-${width}.png`,
		});
		await badgeIcons.screenshot({
			path: `.design-system/state-matrix/badge-icon-${theme}-${width}.png`,
			animations: "disabled",
		});
		const appearance = await badgeIcons
			.locator('[data-slot="badge"]')
			.evaluateAll((badges) =>
				badges.map((badge) => {
					const style = getComputedStyle(badge);
					const icon = badge.querySelector("svg");
					return {
						size: badge.getAttribute("data-size"),
						tone: badge.getAttribute("data-tone"),
						variant: badge.getAttribute("data-variant"),
						height: badge.getBoundingClientRect().height,
						radius: style.borderRadius,
						padding: style.paddingInlineStart,
						icon: icon?.getBoundingClientRect().width ?? null,
						background: style.backgroundColor,
						color: style.color,
						outline: style.outlineWidth,
					};
				}),
			);
		const pageColor = await behaviorPage
			.locator("body")
			.evaluate((body) => getComputedStyle(body).backgroundColor);
		for (const badge of appearance) {
			const expected = badge.size === "small" ? 16.2 : 20;
			if (
				Math.abs(badge.height - expected) > 0.25 ||
				badge.radius !== "6px" ||
				badge.padding !== (badge.size === "small" ? "4px" : "6px") ||
				(badge.icon !== null && badge.icon !== 12)
			) {
				badgeIconFailures.push(
					`${theme} ${width} badge geometry drifted: ${JSON.stringify(badge)}`,
				);
			}
			if (badge.variant === "outline") {
				if (
					badge.outline !== "1px" ||
					badge.background !== "rgba(0, 0, 0, 0)"
				) {
					badgeIconFailures.push(
						`${theme} ${width} outline badge has the wrong surface`,
					);
				}
			}
			if (
				["success", "warning", "danger"].includes(badge.tone ?? "") &&
				badge.background ===
					appearance.find((item) => item.tone === "neutral")?.background
			) {
				badgeIconFailures.push(
					`${theme} ${width} ${badge.tone} badge has no status tint`,
				);
			}
			if (contrast(badge.color, badge.background, pageColor) < 4.5) {
				badgeIconFailures.push(
					`${theme} ${width} ${badge.tone} badge contrast is below 4.5:1`,
				);
			}
		}
	}
}
await behaviorPage.setViewportSize({ width: 640, height: 480 });
const iconCatalog = await badgeIcons
	.locator(":scope > div:last-child > svg")
	.evaluateAll((icons) =>
		icons.map((icon) => ({
			width: Number.parseFloat(getComputedStyle(icon).width),
			height: Number.parseFloat(getComputedStyle(icon).height),
			hidden: icon.getAttribute("aria-hidden"),
			focusable: icon.getAttribute("focusable"),
		})),
	);
if (
	iconCatalog.length !== 10 ||
	iconCatalog.some(
		(icon, index) =>
			icon.width !== [12, 14, 16, 18, 20, 24, 32, 40, 14, 20][index] ||
			icon.height !== icon.width ||
			icon.focusable !== "false" ||
			icon.hidden !== (index === 9 ? null : "true"),
	)
)
	badgeIconFailures.push("Icon size or decorative semantics drifted");
const loadingIcon = badgeIcons.getByRole("img", {
	name: "Loading",
	exact: true,
});
const animation = await loadingIcon.evaluate(
	(icon) => getComputedStyle(icon).animationName,
);
await behaviorPage.emulateMedia({
	reducedMotion: "reduce",
	forcedColors: "active",
});
const reducedAnimation = await loadingIcon.evaluate(
	(icon) => getComputedStyle(icon).animationName,
);
const forcedOutline = await badgeIcons
	.locator('[data-slot="badge"][data-variant="solid"]')
	.first()
	.evaluate((badge) => getComputedStyle(badge).outlineWidth);
await behaviorPage.emulateMedia({
	reducedMotion: "no-preference",
	forcedColors: "none",
});
if (
	animation !== "tripwire-icon-spin" ||
	reducedAnimation !== "none" ||
	forcedOutline !== "1px"
) {
	badgeIconFailures.push("Icon reduced motion or Badge forced colors drifted");
}
reports["badge-icon"] = {
	state: { iconCatalog, animation, reducedAnimation, forcedOutline },
	failures: badgeIconFailures,
};
const groupSizes = await avatarGroups
	.locator('[data-slot="avatar-group"]')
	.evaluateAll((groups) =>
		groups.map((group) => {
			const items = [...group.children];
			const first = items[0];
			const count = items.at(-1);
			const box = count?.getBoundingClientRect();
			return {
				items: items.length,
				avatar: first?.getBoundingClientRect().width ?? 0,
				outline: first ? getComputedStyle(first).outlineWidth : "",
				overlap: count ? getComputedStyle(count).marginInlineStart : "",
				width: box?.width ?? 0,
				height: box?.height ?? 0,
			};
		}),
	);
const countTrigger = avatarGroups
	.locator('[data-slot="avatar-group-count"] [tabindex="0"]')
	.first();
await countTrigger.focus();
await behaviorPage.keyboard.press("Tab");
await behaviorPage.keyboard.press("Shift+Tab");
const namesTooltip = behaviorPage
	.getByRole("tooltip")
	.filter({ hasText: "Demo agent, Source catalog" });
await namesTooltip.waitFor({ timeout: 2000 });
await behaviorPage.keyboard.press("Escape");
await namesTooltip.waitFor({ state: "hidden", timeout: 2000 });
const countRetainsFocus = await countTrigger.evaluate(
	(element) => document.activeElement === element,
);
const namesAreDescribed = await countTrigger.evaluate((element) => {
	const id = element.getAttribute("aria-describedby");
	return id
		? document.getElementById(id)?.textContent === "Demo agent, Source catalog"
		: false;
});
await countTrigger.evaluate((element) => element.blur());
await countTrigger.hover();
await namesTooltip.waitFor({ timeout: 2000 });
await behaviorPage.mouse.move(630, 470);
await namesTooltip.waitFor({ state: "hidden", timeout: 2000 });
const groupFailures = groupSizes.flatMap((group, index) => {
	const expected = [16, 20, 24, 32][index];
	return group.items === 3 &&
		group.avatar === expected &&
		group.width === expected &&
		group.height === expected &&
		group.outline === "2px" &&
		group.overlap === (index === 3 ? "-4px" : "-2px")
		? []
		: [`Avatar group size ${expected} drifted`];
});
if (!countRetainsFocus)
	groupFailures.push("Avatar overflow loses focus on Escape");
if (!namesAreDescribed)
	groupFailures.push("Avatar overflow does not describe hidden names");
if (
	(await avatarGroups.locator('[data-slot="avatar-fallback"] svg').count()) !==
	5
) {
	groupFailures.push("Avatar agent or source fallback glyph is missing");
}
reports["avatar-group"] = {
	state: { groupSizes, countRetainsFocus },
	failures: groupFailures,
};
const avatarProgressState = await feedback.evaluate((section) => {
	const avatar = (name: string) => {
		const root = section.querySelector(`[aria-label="${name}"]`);
		const image = root?.querySelector("img");
		const fallback = root?.querySelector('[data-slot="avatar-fallback"]');
		return {
			imageOpacity: image ? getComputedStyle(image).opacity : null,
			fallbackVisibility: fallback
				? getComputedStyle(fallback).visibility
				: null,
			fallbackText: fallback?.textContent ?? null,
		};
	};
	const progress = section.querySelector(
		'[role="progressbar"]:not([data-indeterminate])',
	);
	const loading = section.querySelector(
		'[role="progressbar"][data-indeterminate]',
	);
	const indicator = loading?.querySelector('[data-slot="progress-indicator"]');
	return {
		broken: avatar("Demo owner"),
		loaded: avatar("Demo reviewer"),
		valueText: progress?.getAttribute("aria-valuetext") ?? null,
		current: progress?.getAttribute("aria-valuenow") ?? null,
		loadingCurrent: loading?.getAttribute("aria-valuenow") ?? null,
		loadingAnimation: indicator
			? getComputedStyle(indicator).animationName
			: null,
	};
});
await behaviorPage.emulateMedia({ reducedMotion: "reduce" });
const reducedSweep = await feedback
	.locator('[data-slot="progress-indicator"][data-indeterminate]')
	.evaluate((element) => getComputedStyle(element).animationName);
const reducedTransition = await feedback
	.locator('[data-slot="progress-indicator"]:not([data-indeterminate])')
	.evaluate((element) => getComputedStyle(element).transitionDuration);
const reducedFill = await feedback
	.locator('[data-slot="progress-indicator"][data-indeterminate]')
	.evaluate((element) => ({
		start: getComputedStyle(element).insetInlineStart,
		ratio:
			element.getBoundingClientRect().width /
			(element.parentElement?.getBoundingClientRect().width ?? 1),
	}));
await behaviorPage.emulateMedia({ reducedMotion: "no-preference" });
const progressEdges = await behaviorPage
	.locator('#progress-edge-fixture [data-slot="progress-indicator"]')
	.evaluateAll((indicators) =>
		indicators.map((element) => ({
			width: element.getBoundingClientRect().width,
			height: element.getBoundingClientRect().height,
			hairline: element.parentElement
				? getComputedStyle(element.parentElement, "::after").borderTopWidth
				: "",
		})),
	);
const reviewer = feedback.getByRole("img", { name: "Demo reviewer" });
await reviewer.click();
const swappedImageOpacity = await reviewer
	.locator("img")
	.evaluate((element) => getComputedStyle(element).opacity);
await reviewer.click();
await reviewer.locator("img[data-loaded]").waitFor();
const avatarProgressFailures: string[] = [];
if (
	avatarProgressState.broken.imageOpacity !== "0" ||
	avatarProgressState.broken.fallbackVisibility !== "visible" ||
	avatarProgressState.broken.fallbackText !== "DO" ||
	avatarProgressState.loaded.imageOpacity !== "1" ||
	avatarProgressState.loaded.fallbackVisibility !== "hidden" ||
	swappedImageOpacity !== "0"
) {
	avatarProgressFailures.push(
		"Avatar image and fallback do not match image load state",
	);
}
if (
	avatarProgressState.valueText !== "12 of 35" ||
	avatarProgressState.current !== "12" ||
	avatarProgressState.loadingCurrent !== null ||
	avatarProgressState.loadingAnimation !== "tripwire-sweep" ||
	reducedSweep !== "none" ||
	reducedTransition !== "0s" ||
	reducedFill.start !== "0px" ||
	Math.abs(reducedFill.ratio - 0.5) > 0.01 ||
	progressEdges[0]?.width !== progressEdges[0]?.height ||
	progressEdges[0]?.hairline !== "1px" ||
	progressEdges[1]?.width !== 0
) {
	avatarProgressFailures.push(
		"Progress value or indeterminate motion contract drifted",
	);
}
reports["avatar-progress"] = {
	state: {
		...avatarProgressState,
		reducedSweep,
		reducedTransition,
		reducedFill,
		progressEdges,
		swappedImageOpacity,
	},
	failures: avatarProgressFailures,
};
await membersTab.focus();
await membersTab.press("ArrowRight");
const afterArrow = await behaviorPage.evaluate(() => ({
	focused: document.activeElement?.textContent?.trim() ?? null,
	selected:
		document
			.querySelector('[role="tab"][aria-selected="true"]')
			?.textContent?.trim() ?? null,
}));
await pendingTab.press("Home");
const afterHome = await behaviorPage.evaluate(() => ({
	focused: document.activeElement?.textContent?.trim() ?? null,
	selected:
		document
			.querySelector('[role="tab"][aria-selected="true"]')
			?.textContent?.trim() ?? null,
}));
await membersTab.press("End");
const afterEnd = await behaviorPage.evaluate(() => ({
	focused: document.activeElement?.textContent?.trim() ?? null,
	selected:
		document
			.querySelector('[role="tab"][aria-selected="true"]')
			?.textContent?.trim() ?? null,
}));
const tabsFailures: string[] = [];
if (afterArrow.focused !== "Pending" || afterArrow.selected !== "Pending") {
	tabsFailures.push("ArrowRight did not focus and select the next enabled tab");
}
if (afterHome.focused !== "Members" || afterHome.selected !== "Members") {
	tabsFailures.push("Home did not focus and select the first enabled tab");
}
if (afterEnd.focused !== "Archived" || afterEnd.selected !== "Members") {
	tabsFailures.push(
		"End did not focus the last disabled tab while preserving selection",
	);
}
reports["tabs-keyboard"] = {
	state: { afterArrow, afterEnd, afterHome },
	failures: tabsFailures,
};
const toolbarFailures: string[] = [];
const toolbarStates: Record<string, JsonValue> = {};
for (const orientation of ["horizontal", "vertical"] as const) {
	const toolbar = behaviorPage.getByRole("toolbar", {
		name: `${orientation} tools`,
	});
	const action = toolbar.getByRole("button", { name: "Refresh" });
	const disabled = toolbar.getByRole("button", { name: "Unavailable" });
	const link = toolbar.getByRole("link", { name: "Help" });
	const separator = toolbar.getByRole("separator");
	const size = await separator.evaluate((element) => {
		const { width, height } = element.getBoundingClientRect();
		const style = getComputedStyle(element);
		const root = element.closest('[role="toolbar"]');
		return {
			width,
			height,
			inlineMargin: style.marginInlineStart,
			blockMargin: style.marginBlockStart,
			gap: root ? getComputedStyle(root).gap : "",
		};
	});
	const dividerRunsAcross =
		orientation === "horizontal"
			? size.height === 16 && size.width === 1 && size.inlineMargin === "4px"
			: size.width > size.height &&
				size.height === 1 &&
				size.blockMargin === "4px";
	const next = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
	await behaviorPage.evaluate(() => delete document.body.dataset.action);
	await action.focus();
	await behaviorPage.keyboard.press(next);
	const disabledFocused = await disabled.evaluate(
		(element) => document.activeElement === element,
	);
	await behaviorPage.keyboard.press("Enter");
	const disabledFired = await behaviorPage
		.locator("body")
		.getAttribute("data-action");
	await disabled.click({ force: true });
	const disabledPointerFired = await behaviorPage
		.locator("body")
		.getAttribute("data-action");
	await disabled.focus();
	await behaviorPage.keyboard.press(next);
	const linkFocused = await link.evaluate(
		(element) => document.activeElement === element,
	);
	await behaviorPage.keyboard.press("Home");
	const homeFocused = await action.evaluate(
		(element) => document.activeElement === element,
	);
	await behaviorPage.keyboard.press("Space");
	const actionSource = await behaviorPage
		.locator("body")
		.getAttribute("data-action");
	await behaviorPage.keyboard.press("End");
	const endFocused = await link.evaluate(
		(element) => document.activeElement === element,
	);
	await behaviorPage.keyboard.press("Tab");
	const leavesGroup = await toolbar.evaluate(
		(element) => !element.contains(document.activeElement),
	);
	if (
		!disabledFocused ||
		disabledFired ||
		disabledPointerFired ||
		!linkFocused ||
		!homeFocused ||
		!endFocused ||
		!leavesGroup ||
		actionSource !== "keyboard"
	) {
		toolbarFailures.push(`${orientation} toolbar keyboard behavior drifted`);
	}
	if (!dividerRunsAcross || size.gap !== "2px") {
		toolbarFailures.push(
			`${orientation} toolbar separator geometry or spacing drifted`,
		);
	}
	toolbarStates[orientation] = {
		disabledFocused,
		disabledFired,
		disabledPointerFired,
		linkFocused,
		homeFocused,
		endFocused,
		leavesGroup,
		actionSource,
		separatorSize: size,
	};
}
reports["toolbar-keyboard"] = {
	state: toolbarStates,
	failures: toolbarFailures,
};
await behaviorContext.close();

await browser.close();
await styleServer?.close();
console.log(JSON.stringify(reports, null, 2));
if (Object.values(reports).some((report) => report.failures.length > 0)) {
	process.exitCode = 1;
}
