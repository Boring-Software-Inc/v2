import { Link } from "@tanstack/react-router";
import { Button } from "#/design-system/ui/button";
import { SectionHeading, SupportingText } from "#/design-system/ui/typography";
import { useSharedBlocklistPilot } from "#/hooks/use-shared-blocklist-pilot";

export function SharedBlocklistRuleCard() {
	const { pilot, save } = useSharedBlocklistPilot();
	if (!pilot) return null;

	return (
		<section
			id="shared-spam-blocklist"
			aria-labelledby="shared-blocklist-rule-title"
			data-layout-role="dashboard-news-card"
		>
			<SectionHeading id="shared-blocklist-rule-title">Pilot</SectionHeading>
			<SupportingText>
				{pilot.enabled ? "On · Review only" : "Off · Review only"}
			</SupportingText>
			<SupportingText>
				Send pull requests from listed accounts to Human review.
			</SupportingText>
			<div data-layout-role="public-blocklist-search">
				<Button
					disabled={save.isPending}
					onClick={() => save.mutate(!pilot.enabled)}
					size="sm"
					variant="secondary"
				>
					{pilot.enabled ? "Turn off" : "Turn on"}
				</Button>
				<Link to="/pilot">Browse the public list</Link>
			</div>
			{save.isError ? (
				<SupportingText role="alert">Couldn’t save. Try again.</SupportingText>
			) : null}
		</section>
	);
}
