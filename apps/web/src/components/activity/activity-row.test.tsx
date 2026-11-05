import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	type ActivityGroup,
	type ActivityTimelineEntry,
	normalizedEventSchema,
} from "@tripwire/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityRow } from "#/components/activity/activity-row";
import { ActivityStack } from "#/components/activity/activity-stack";

const unavailable: ActivityTimelineEntry = {
	eventId: "historical-invalid",
	event: null,
	run: null,
	unavailableReason: "Historical event data is unavailable",
};

test("standalone invalid history renders the explicit unavailable state with no forged identity or action", () => {
	const html = renderToStaticMarkup(<ActivityRow item={unavailable} />);
	expect(html).toContain("Historical event data is unavailable");
	expect(html).not.toContain("href=");
	expect(html).not.toContain("Checking");
});

test("a mixed timeline renders unavailable history alongside its valid neighboring event", async () => {
	const event = normalizedEventSchema.parse(
		await Bun.file(
			new URL(
				"../../../../../packages/core/fixtures/change-request.opened.event.json",
				import.meta.url,
			),
		).json(),
	);
	const group: ActivityGroup = {
		repoFullName: "Codertocat/Hello-World",
		subjectNumber: 2,
		title: "Update the README",
		url: null,
		actor: { login: event.actor.login, avatarUrl: null },
		currentVerdict: null,
		currentRunId: null,
		latestActivityAt: event.receivedAt,
		eventCount: 2,
		timeline: [unavailable, { eventId: event.id, event, run: null }],
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const html = renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<ActivityStack group={group} />
		</QueryClientProvider>,
	);
	expect(html).toContain("Historical event data is unavailable");
	expect(html).toContain("Codertocat");
	expect(html).toContain("opened");
	expect(html).toContain('aria-label="Timeline of #2"');
	client.clear();
});
