import { describe, expect, test } from "bun:test";
import { mapPaletteItemToCommandItem } from "./command-palette";

describe("command palette row mapping", () => {
	test("preserves the finite identity and status anatomy", () => {
		const onSelect = () => undefined;
		const item = mapPaletteItemToCommandItem({
			current: true,
			icon: null,
			id: "org:grim",
			label: "grim",
			labelBadge: { label: "Personal", variant: "outline" },
			onSelect,
			searchTags: ["grim"],
			statusBadges: [
				{ label: "Tripwire off", variant: "outline" },
				{ label: "2 to review" },
				{ label: "3 blocked", tone: "danger" },
			],
		});

		expect(item).toMatchObject({
			current: true,
			keywords: ["grim"],
			label: "grim",
			labelBadge: { label: "Personal", variant: "outline" },
			onAction: onSelect,
			statusBadges: [
				{ label: "Tripwire off", variant: "outline" },
				{ label: "2 to review" },
				{ label: "3 blocked", tone: "danger" },
			],
			value: "org:grim",
		});
	});

	test("preserves destructive confirmation metadata", () => {
		const item = mapPaletteItemToCommandItem({
			confirmation: {
				confirmLabel: "Sign out",
				description: "Your session ends.",
				title: "Sign out of Tripwire?",
			},
			icon: null,
			id: "action:sign-out",
			label: "Sign out",
			onSelect: () => undefined,
			searchTags: ["logout"],
			variant: "destructive",
		});

		expect(item).toMatchObject({
			confirmation: {
				confirmLabel: "Sign out",
				description: "Your session ends.",
				title: "Sign out of Tripwire?",
			},
			tone: "destructive",
			value: "action:sign-out",
		});
	});
});
