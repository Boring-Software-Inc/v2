import type { HomeDigest } from "@tripwire/contracts";
import { PageHeader } from "@tripwire/ui/layouts";
import { SupportingText } from "@tripwire/ui/typography";
import { DigestCaughtCard } from "#/components/organizations/digest-caught-card";
import { DigestCountsCard } from "#/components/organizations/digest-counts-card";

interface FirstWeekDigestProps {
	org: string;
	digest: HomeDigest;
	timeZone: string;
}

export function FirstWeekDigest({
	org,
	digest,
	timeZone,
}: FirstWeekDigestProps) {
	const date = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		timeZone,
	});
	return (
		<section
			aria-label="This week"
			className="flex flex-col"
			data-layout-role="org-digest"
		>
			<PageHeader
				description={`${date.format(new Date(digest.from))} to ${date.format(new Date(digest.to))}`}
				metadata={
					<SupportingText>
						Counts show runs recorded this week, including repeated checks and
						closed reviews.
					</SupportingText>
				}
				title="This week"
			/>
			<DigestCountsCard digest={digest} org={org} />
			{digest.caught ? (
				<DigestCaughtCard caught={digest.caught} org={org} />
			) : null}
		</section>
	);
}
