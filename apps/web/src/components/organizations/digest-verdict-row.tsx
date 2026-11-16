import type {
	DigestHistoryWindow,
	HomeDigest,
	Verdict,
} from "@tripwire/contracts";
import {
	Blocked,
	FailedMark,
	FollowUp,
	Icon,
	Success,
	Time,
} from "@tripwire/ui/icon";
import { Item, ItemContent, ItemTitle } from "@tripwire/ui/item";
import { ItemRouterLink } from "#/components/common/router-links";
import { DigestActivityMenu } from "#/components/organizations/digest-activity-button";

const VERDICTS = {
	block: { label: "Blocked", icon: FailedMark, tone: "primary" },
	changes_required: {
		label: "Changes needed",
		icon: FollowUp,
		tone: "warning",
	},
	needs_review: { label: "Human review", icon: Time, tone: "warning" },
	pass: { label: "Passed", icon: Success, tone: "success" },
	close: { label: "Closed", icon: Blocked, tone: "primary" },
} as const;

interface DigestVerdictRowProps {
	org: string;
	repos: HomeDigest["repos"];
	verdict: Verdict;
	count: number;
	period: DigestHistoryWindow;
}

export function DigestVerdictRow({
	org,
	repos,
	verdict,
	count,
	period,
}: DigestVerdictRowProps) {
	const { label, icon, tone } = VERDICTS[verdict];
	const repo = repos[0];
	const title = !repo ? (
		label
	) : repos.length === 1 ? (
		<ItemRouterLink
			params={{ org, repo: repo.name }}
			search={{ verdict, ...period }}
			to="/$org/$repo/activity"
		>
			{label}
		</ItemRouterLink>
	) : (
		<DigestActivityMenu
			org={org}
			period={period}
			repos={repos}
			verdict={verdict}
		>
			<button
				type="button"
				className="min-w-0 text-start hover:underline after:absolute after:inset-0 after:content-['']"
				data-slot="item-link"
			>
				{label}
			</button>
		</DigestActivityMenu>
	);
	return (
		<Item data-layout-role="digest-verdict-row" inset>
			<Icon icon={icon} tone={tone} />
			<ItemContent>
				<ItemTitle>{title}</ItemTitle>
			</ItemContent>
			<span className="type-body-sm tabular-nums">{count}</span>
		</Item>
	);
}
