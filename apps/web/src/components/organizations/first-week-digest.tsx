import type { HomeDigest } from "@tripwire/contracts";
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
		<section aria-labelledby="digest-title" className="flex flex-col gap-6">
			<header className="flex flex-col gap-1">
				<h1 className="type-title" id="digest-title">
					This week
				</h1>
				<p className="type-body text-text-2">
					{date.format(new Date(digest.from))} to{" "}
					{date.format(new Date(digest.to))}
				</p>
			</header>
			<DigestCountsCard digest={digest} org={org} />
			{digest.caught ? (
				<DigestCaughtCard caught={digest.caught} org={org} />
			) : null}
		</section>
	);
}
