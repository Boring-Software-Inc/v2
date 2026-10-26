import type { HomeDigest, Verdict } from "@tripwire/contracts";
import { ItemRouterLink } from "#/components/common/router-links";
import {
	Blocked,
	FailedMark,
	FollowUp,
	Icon,
	Success,
	Time,
} from "#/components/glaze/icon";
import { DropdownMenuTrigger } from "#/components/glaze/ui/dropdown-menu";
import { Item, ItemContent, ItemTitle } from "#/components/glaze/ui/item";
import { DigestActivityMenu } from "#/components/organizations/digest-activity-button";

const VERDICTS = {
	block: { label: "Blocked", icon: FailedMark, color: "text-text-1" },
	changes_required: {
		label: "Changes needed",
		icon: FollowUp,
		color: "text-warn",
	},
	needs_review: { label: "Human review", icon: Time, color: "text-warn" },
	pass: { label: "Passed", icon: Success, color: "text-ok" },
	close: { label: "Closed", icon: Blocked, color: "text-text-1" },
} as const;

interface DigestVerdictRowProps {
	org: string;
	repos: HomeDigest["repos"];
	verdict: Verdict;
	count: number;
}

export function DigestVerdictRow({
	org,
	repos,
	verdict,
	count,
}: DigestVerdictRowProps) {
	const { label, icon, color } = VERDICTS[verdict];
	const repo = repos[0];
	const filter =
		verdict === "block" || verdict === "needs_review" || verdict === "pass"
			? verdict
			: null;
	const title =
		!filter || !repo ? (
			label
		) : repos.length === 1 ? (
			<ItemRouterLink
				params={{ org, repo: repo.name }}
				search={{ verdict: filter }}
				to="/$org/$repo/activity"
			>
				{label}
			</ItemRouterLink>
		) : (
			<DigestActivityMenu org={org} repos={repos} verdict={filter}>
				<DropdownMenuTrigger
					className="min-w-0 text-start hover:underline after:absolute after:inset-0 after:content-['']"
					data-slot="item-link"
				>
					{label}
				</DropdownMenuTrigger>
			</DigestActivityMenu>
		);
	return (
		<Item className="min-h-11 gap-2 px-0">
			<Icon className={color} icon={icon} />
			<ItemContent>
				<ItemTitle>{title}</ItemTitle>
			</ItemContent>
			<span className="type-body-sm tabular-nums">{count}</span>
		</Item>
	);
}
