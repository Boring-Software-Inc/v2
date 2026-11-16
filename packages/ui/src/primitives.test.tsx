import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentBoundary } from "./agent-policy";
import { ActionLink, Button, IconButton } from "./button";
import { Checkbox, CheckboxGroup } from "./checkbox";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldSet,
	Input,
	Textarea,
} from "./field";
import { shouldConfirmLocally } from "./interaction";
import { Select } from "./select";
import { Switch } from "./switch";
import { Tabs } from "./tabs";

describe("Tripwire behavior primitives", () => {
	test("marks destructive actions for the agent and confirmation host", () => {
		const markup = renderToStaticMarkup(
			<Button
				confirmation={{
					title: "Delete this organization?",
					description: "This cannot be undone.",
					confirmLabel: "Delete organization",
				}}
				onAction={() => undefined}
				variant="destructive"
			>
				Delete organization
			</Button>,
		);
		expect(markup).toContain('data-agent-confirm="Delete this organization?"');
		expect(markup).toContain('data-slot="button"');
		expect(markup).toContain('data-variant="destructive"');
	});

	test("uses one destructive confirmation gate for each source", () => {
		expect(shouldConfirmLocally("agent")).toBe(false);
		expect(shouldConfirmLocally("keyboard")).toBe(true);
		expect(shouldConfirmLocally("mouse")).toBe(true);
	});

	test("supports pending action and semantic navigation buttons", () => {
		const markup = renderToStaticMarkup(
			<>
				<Button leadingIcon={<span>↗</span>} pending pendingLabel="Saving">
					Save
				</Button>
				<Button href="/settings" onNavigate={() => undefined}>
					Settings
				</Button>
			</>,
		);
		expect(markup).toContain('data-pending=""');
		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain("Saving");
		expect(markup).toContain('href="/settings"');
	});

	test("preserves keyboard shortcut semantics on action controls", () => {
		const markup = renderToStaticMarkup(
			<Button ariaKeyShortcuts="Meta+K Control+K" onAction={() => undefined}>
				Search
			</Button>,
		);
		expect(markup).toContain('aria-keyshortcuts="Meta+K Control+K"');
		expect(markup).toContain('data-size="medium"');
	});

	test("gives icon-only controls an accessible name", () => {
		const markup = renderToStaticMarkup(
			<IconButton icon={<span>×</span>} label="Close" />,
		);
		expect(markup).toContain('aria-label="Close"');
		expect(markup).toContain('aria-hidden="true"');
	});

	test("secures links that open a new tab", () => {
		const markup = renderToStaticMarkup(
			<ActionLink href="https://example.com" openInNewTab>
				Preview portal
			</ActionLink>,
		);
		expect(markup).toContain('target="_blank"');
		expect(markup).toContain('rel="noreferrer"');
	});

	test("connects fields to native controls and messages", () => {
		const markup = renderToStaticMarkup(
			<Field invalid name="email">
				<FieldLabel>Email</FieldLabel>
				<Input labelledByField required type="email" />
				<FieldDescription>Used for account notices.</FieldDescription>
				<FieldError>Enter a valid email.</FieldError>
			</Field>,
		);
		expect(markup).toContain('data-slot="field"');
		expect(markup).toContain('data-slot="field-label"');
		expect(markup).toContain('data-slot="input"');
		expect(markup).toContain('aria-invalid="true"');
		expect(markup).toContain("Enter a valid email.");
		expect(() => renderToStaticMarkup(<Input labelledByField />)).toThrow(
			"Input declared a Field label outside a Field",
		);
		expect(() => renderToStaticMarkup(<Textarea labelledByField />)).toThrow(
			"Textarea declared a Field label outside a Field",
		);
	});

	test("supports field sets and finite input affordances", () => {
		const markup = renderToStaticMarkup(
			<FieldSet
				description="Applies to every repository."
				legend="Review window"
			>
				<Field name="days" orientation="horizontal">
					<FieldLabel>Days</FieldLabel>
					<Input
						ariaDescribedBy="days-help"
						labelledByField
						copy={{ value: "7" }}
						defaultValue="7"
						invalid
						leadingIcon={<span>#</span>}
						max={30}
						min={1}
						type="number"
					/>
				</Field>
			</FieldSet>,
		);
		expect(markup).toContain("<fieldset");
		expect(markup).toContain("<legend");
		expect(markup).toContain('data-orientation="horizontal"');
		expect(markup).toContain('aria-describedby="days-help ');
		expect(markup).toContain('aria-invalid="true"');
		expect(markup).toContain('type="number"');
		expect(markup).toContain('data-slot="input-group"');
	});

	test("keeps textarea, checkbox, and switch semantics native", () => {
		const markup = renderToStaticMarkup(
			<>
				<Textarea ariaLabel="Appeal reason" maxLength={500} />
				<Checkbox label="Email updates" name="updates" />
				<Switch label="Reduce motion" name="reduce-motion" />
			</>,
		);
		expect(markup).toContain('aria-label="Appeal reason"');
		expect(markup).toContain('maxLength="500"');
		expect(markup).toContain('type="checkbox"');
		expect(markup).toContain("Email updates");
		expect(markup).toContain('role="switch"');
		expect(markup).toContain("Reduce motion");
	});

	test("supports external checkbox names, mixed state, and groups", () => {
		const markup = renderToStaticMarkup(
			<>
				<span id="all-label">All repositories</span>
				<Checkbox ariaLabelledBy="all-label" checked="indeterminate" />
				<CheckboxGroup
					ariaLabel="Repositories"
					defaultValue={["api"]}
					options={[
						{ label: "API", value: "api" },
						{ label: "Web", value: "web" },
					]}
				/>
			</>,
		);
		expect(markup).toContain('aria-labelledby="all-label"');
		expect(markup).toContain('aria-checked="mixed"');
		expect(markup).toContain('data-slot="checkbox-group"');
		expect(markup).toContain('aria-label="Repositories"');
	});

	test("supports externally named pending switches", () => {
		const markup = renderToStaticMarkup(
			<>
				<span id="motion-label">Reduce motion</span>
				<Switch ariaLabelledBy="motion-label" pending size="small" />
			</>,
		);
		expect(markup).toContain('aria-labelledby="motion-label"');
		expect(markup).toContain('data-pending=""');
		expect(markup).toContain('data-size="small"');
	});

	test("renders one tab panel for every semantic tab", () => {
		const markup = renderToStaticMarkup(
			<Tabs
				ariaLabel="Members"
				defaultValue="active"
				items={[
					{ content: "Active members", label: "Members", value: "active" },
					{ content: "Pending invites", label: "Pending", value: "pending" },
				]}
			/>,
		);
		expect(markup).toContain('aria-label="Members"');
		expect(markup).toContain('role="tablist"');
		expect(markup).toContain("Active members");
	});

	test("supports tab actions and externally rendered panels", () => {
		const markup = renderToStaticMarkup(
			<Tabs
				actions={[
					{
						label: "Invite member",
						onAction: () => undefined,
						value: "invite",
					},
				]}
				ariaLabel="Members"
				items={[{ count: 3, label: "Members", value: "members" }]}
				panelMode="external"
			/>,
		);
		expect(markup).toContain('data-slot="tabs-count"');
		expect(markup).toContain('data-slot="tabs-actions"');
		expect(markup).not.toContain('data-slot="tabs-panel"');
	});

	test("renders the finite compact tab geometry", () => {
		const markup = renderToStaticMarkup(
			<Tabs
				ariaLabel="Workspace access"
				items={[
					{ label: "Members", value: "members" },
					{ label: "Pending", value: "pending" },
				]}
				panelMode="external"
				size="small"
			/>,
		);
		expect(markup).toContain('data-size="small"');
		expect(markup).toContain('aria-label="Workspace access"');
	});

	test("renders native and popup selects from stable string options", () => {
		const dynamicEmptyValue = "" as string;
		const nativeMarkup = renderToStaticMarkup(
			<Select
				ariaLabel="Role"
				mode="native"
				options={[{ label: "Admin", value: "admin" }]}
			/>,
		);
		const popupMarkup = renderToStaticMarkup(
			<Select
				ariaLabel="Workspace"
				options={[
					{
						description: "Personal workspace",
						label: "grim",
						value: "grim",
					},
				]}
			/>,
		);
		expect(nativeMarkup).toContain("<select");
		expect(nativeMarkup).toContain("Admin");
		expect(popupMarkup).toContain('aria-label="Workspace"');
		expect(() =>
			renderToStaticMarkup(
				<Select
					ariaLabel="Invalid value"
					options={[{ label: "Empty", value: dynamicEmptyValue }]}
				/>,
			),
		).toThrow("Select option values must be non-empty strings.");
	});

	test("hides and redacts bounded content from agents", () => {
		const markup = renderToStaticMarkup(
			<AgentBoundary
				confirmation="Reveal recovery code"
				exposure="secret"
				visibility="hidden"
			>
				Recovery code
			</AgentBoundary>,
		);
		expect(markup).toContain('data-agent-hidden=""');
		expect(markup).toContain('data-agent-secret=""');
		expect(markup).toContain('data-agent-confirm="Reveal recovery code"');
	});
});
