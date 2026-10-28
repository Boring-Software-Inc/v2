import type { HomeDigest } from "@tripwire/contracts";
import {
	Card,
	CardContent,
	CardFooter,
	CardMeta,
} from "#/components/glaze/ui/card";
import { ItemGroup } from "#/components/glaze/ui/item";
import { DigestActivityButton } from "#/components/organizations/digest-activity-button";
import { DigestVerdictRow } from "#/components/organizations/digest-verdict-row";

interface DigestCountsCardProps {
	org: string;
	digest: HomeDigest;
}

export function DigestCountsCard({ org, digest }: DigestCountsCardProps) {
	const footer =
		digest.repos.length === 1
			? `${digest.total} runs on ${digest.repos[0]?.name}`
			: `${digest.total} runs across ${digest.repos.length} repos`;
	return (
		<Card>
			<CardContent className="p-1" flush>
				<ItemGroup
					aria-label="This week's run verdicts"
					className="gap-1"
					variant="plain"
				>
					{digest.counts.map((row) => (
						<DigestVerdictRow
							key={row.verdict}
							org={org}
							period={{ from: digest.from, to: digest.to }}
							repos={digest.repos}
							{...row}
						/>
					))}
				</ItemGroup>
			</CardContent>
			<CardFooter>
				<CardMeta>{footer}</CardMeta>
				<DigestActivityButton
					org={org}
					period={{ from: digest.from, to: digest.to }}
					repos={digest.repos}
				/>
			</CardFooter>
		</Card>
	);
}
