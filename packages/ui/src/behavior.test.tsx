import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Accordion, Collapsible } from "./collapsible";
import { Combobox } from "./combobox";
import { Command, CommandDialog } from "./command";
import { DestructiveDialog, Dialog } from "./dialog";
import { Drawer } from "./drawer";
import { interactionFromEvent } from "./interaction";
import { Menu } from "./menu";
import { NumberInput } from "./number-input";
import { Progress } from "./progress";
import { RadioGroup, SegmentedControl } from "./radio-group";
import { Slider, StepSlider } from "./slider";
import { Toolbar } from "./toolbar";

describe("Tripwire interactive behavior facade", () => {
	test("connects radio choices to accessible names and descriptions", () => {
		const markup = renderToStaticMarkup(
			<RadioGroup
				ariaLabel="Theme"
				defaultValue="system"
				options={[
					{ label: "Light", value: "light" },
					{
						description: "Follow the operating system setting.",
						label: "System",
						value: "system",
					},
				]}
			/>,
		);
		expect(markup).toContain('role="radiogroup"');
		expect(markup).toContain('aria-label="Theme"');
		expect(markup).toContain("aria-labelledby=");
		expect(markup).toContain("aria-describedby=");
		expect(markup).toContain("Follow the operating system setting.");
	});

	test("builds segmented controls from the radio-group behavior", () => {
		const markup = renderToStaticMarkup(
			<SegmentedControl
				ariaLabel="Member state"
				options={[
					{ count: 12, label: "Active", value: "active" },
					{ badge: "New", label: "Pending", value: "pending" },
				]}
			/>,
		);
		expect(markup).toContain('data-slot="segmented-control"');
		expect(markup).toContain('role="radiogroup"');
		expect(markup).toContain('type="radio"');
		expect(markup).toContain('data-slot="segmented-count"');
		expect(markup).toContain('data-slot="radio-badge"');
	});

	test("exposes disclosure controls with native expanded state", () => {
		const markup = renderToStaticMarkup(
			<>
				<Collapsible defaultOpen trigger="Details">
					Audit details
				</Collapsible>
				<Collapsible
					header={{
						content: "Passed checks",
						trailing: "4 total",
						trigger: "Show",
						triggerPosition: "after-content",
					}}
				>
					Check details
				</Collapsible>
				<Accordion
					defaultValue={["first"]}
					items={[
						{
							content: "Policy body",
							count: 2,
							label: "Policy",
							panelVariant: "bordered",
							value: "first",
						},
					]}
				/>
			</>,
		);
		expect(markup).toContain('aria-expanded="true"');
		expect(markup).toContain('data-slot="accordion-trigger"');
		expect(markup).toContain("Audit details");
		expect(markup).toContain("Policy body");
		expect(markup).toContain('data-slot="accordion-count"');
		expect(markup).toContain('data-variant="bordered"');
		expect(markup).toContain('data-slot="collapsible-summary-content"');
		expect(markup).toContain('data-slot="collapsible-trailing"');
	});

	test("keeps numeric controls and progress machine-readable", () => {
		const markup = renderToStaticMarkup(
			<>
				<span id="review-window-label">Review window</span>
				<Slider
					ariaLabel="Confidence"
					defaultValue={60}
					getValueText={(value) => `${value} percent`}
					ticks={[
						{ label: "Low", value: 0 },
						{ label: "High", value: 100 },
					]}
				/>
				<StepSlider
					ariaLabel="Severity"
					defaultValue={1}
					steps={[
						{ label: "Low", value: 0 },
						{ label: "High", value: 1 },
					]}
				/>
				<NumberInput
					ariaLabel="Review days"
					defaultValue={7}
					min={1}
					unit="days"
				/>
				<NumberInput ariaLabelledBy="review-window-label" defaultValue={14} />
				<Progress
					label="Importing repositories"
					value={40}
					valueText="4 of 10"
				/>
				<Progress ariaLabel="Loading route" showHeader={false} size="compact" />
			</>,
		);
		expect(markup).toContain('role="slider"');
		expect(markup).toContain('aria-label="Confidence"');
		expect(markup).toMatch(/<input[^>]*aria-valuetext="60 percent"/);
		expect(markup).toContain('aria-label="Review days"');
		expect(markup).toMatch(/aria-labelledby="[^"]+ review-window-label"/);
		expect(markup).toContain(">Decrease</span>");
		expect(markup).toContain(">Increase</span>");
		expect(markup).toContain('role="progressbar"');
		expect(markup).toContain("Importing repositories");
		expect(markup).toContain("60 percent");
		expect(markup).toContain("days");
		expect(markup).toContain("4 of 10");
		expect(markup).toContain('data-size="compact"');
	});

	test("gives searchable collections explicit input names", () => {
		const markup = renderToStaticMarkup(
			<>
				<Combobox
					allowCustomValue
					ariaLabel="Choose a workspace"
					createLabel={(query) => `Create ${query}`}
					isItemEqualToValue={(item, value) => item.slug === value.slug}
					itemToLabel={(value) => value.slug}
					itemToValue={(value) => value.slug}
					onCreate={() => undefined}
					options={[
						{
							description: "Admin",
							id: "demo-team",
							label: "Demo team",
							value: { slug: "demo-team" },
						},
					]}
				/>
				<Command
					ariaLabel="Search Tripwire"
					emptyContent={<span>No matching destination</span>}
					items={[
						{
							content: <span>Recent destinations</span>,
							id: "recent",
							type: "content",
						},
						{
							items: [
								{
									confirmation: {
										confirmLabel: "Sign out",
										title: "Sign out of Tripwire?",
									},
									label: "Sign out",
									onAction: () => undefined,
									tone: "destructive",
									value: "sign-out",
								},
								{
									current: true,
									label: "Open settings",
									labelBadge: {
										label: "Personal",
										variant: "outline",
									},
									onAction: () => undefined,
									statusBadges: [{ label: "2 to review" }],
									value: "settings",
								},
							],
							label: "Pages",
							type: "group",
						},
					]}
				/>
			</>,
		);
		expect(markup).toContain('aria-label="Choose a workspace"');
		expect(markup).toContain('aria-label="Search Tripwire"');
		expect(markup).toContain("Open settings");
		expect(markup).toContain("Pages");
		expect(markup).toContain("Current");
		expect(markup).toContain("Personal");
		expect(markup).toContain("2 to review");
		expect(markup).toContain('data-slot="command-item-copy"');
		expect(markup).toContain('data-slot="command-item-text"');
		expect(markup).toContain('data-slot="command-item-status"');
		expect(markup).toContain('data-slot="command-content"');
		expect(markup).toContain('data-agent-confirm="Sign out of Tripwire?"');
		expect(markup).toContain('data-tone="destructive"');
	});

	test("keeps command dialog geometry on an attribute ui-sdk preserves", () => {
		const markup = renderToStaticMarkup(
			<CommandDialog
				ariaLabel="Search Tripwire"
				defaultOpen
				items={[]}
				title="Command palette"
			/>,
		);
		expect(markup).toContain('data-command-dialog=""');
		expect(markup).toContain('class="ui-sr-only"');
	});

	test("keeps toolbar actions in one named keyboard group", () => {
		const markup = renderToStaticMarkup(
			<Toolbar
				ariaLabel="Editor actions"
				items={[
					{
						label: "Save",
						onAction: () => undefined,
						type: "action",
						value: "save",
					},
				]}
			/>,
		);
		expect(markup).toContain('role="toolbar"');
		expect(markup).toContain('aria-label="Editor actions"');
		expect(markup).toContain("Save");
	});

	test("keeps controlled overlays inside finite structured contracts", () => {
		const markup = renderToStaticMarkup(
			<>
				<Dialog
					action={{ label: "Save", onAction: () => undefined }}
					defaultOpen
					headerTrailing={<span>Draft</span>}
					title="Edit rule"
				>
					Rule form
				</Dialog>
				<Drawer
					defaultOpen
					headerLeading={<span>TW</span>}
					showCloseAction={false}
					title="Member details"
				>
					Member body
				</Drawer>
				<Menu
					ariaLabel="Actions"
					defaultOpen
					items={[
						{
							label: "Workspace",
							type: "label",
							value: "workspace-label",
						},
						{
							description: "owner@tripwire.demo",
							label: "Archive",
							onAction: () => undefined,
							value: "archive",
						},
					]}
					trigger={<button type="button">Actions</button>}
					triggerTooltip={{
						children: "Open actions",
						placement: "right",
						variant: "sidebar",
					}}
					width="popover"
				/>
			</>,
		);
		expect(markup).toContain('data-slot="dialog-heading"');
		expect(markup).toContain('data-slot="dialog-header-leading"');
		expect(markup).toContain("Save");
		expect(markup).toContain("Workspace");
		expect(markup).toContain("Archive");
		expect(markup).toContain("owner@tripwire.demo");
		expect(markup).toContain('data-has-description=""');
		expect(markup).toContain('data-width="popover"');
		expect(markup).toContain("aria-describedby=");
		expect(markup).toContain('data-variant="sidebar"');
	});

	test("renders controlled destructive confirmation semantics", () => {
		const markup = renderToStaticMarkup(
			<DestructiveDialog
				confirmLabel="Delete org"
				confirmText="acme"
				description="This cannot be undone."
				onConfirm={() => Promise.resolve()}
				onOpenChange={() => undefined}
				open
				pendingLabel="Deleting"
				secondaryAction={{
					label: "Back",
					onAction: () => undefined,
				}}
				title="Delete Acme?"
			/>,
		);
		expect(markup).toContain("Delete Acme?");
		expect(markup).toContain("Type <strong>acme</strong> to confirm");
		expect(markup).toContain('data-variant="destructive"');
		expect(markup).toContain('data-agent-confirm="Delete Acme?"');
		expect(markup).toContain('data-slot="dialog-secondary-action"');
		expect(markup).toContain('data-slot="dialog-cancel"');
		expect(markup).toContain('data-slot="alert-dialog-backdrop"');
		expect(markup).toContain('data-slot="alert-dialog-title"');
		expect(markup).toContain('data-slot="alert-dialog-description"');
		expect(markup).toMatch(
			/<button\b[^>]*data-agent-confirm="Delete Acme\?"[^>]*\bdisabled=""[^>]*>/,
		);
		expect(markup).toContain('data-slot="dialog-form"');
	});

	test("normalizes event intent for keyboard and pointer sources", () => {
		class KeyboardIntentEvent extends Event {}
		class PointerIntentEvent extends Event {
			readonly pointerType = "touch";
		}

		expect(interactionFromEvent(new KeyboardIntentEvent("keydown"))).toEqual({
			source: "keyboard",
		});
		expect(interactionFromEvent(new PointerIntentEvent("pointerdown"))).toEqual(
			{
				source: "touch",
			},
		);
		expect(interactionFromEvent()).toEqual({ source: "programmatic" });
	});
});
