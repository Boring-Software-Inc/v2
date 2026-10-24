import { useQuery } from "@tanstack/react-query";
import { ItemRouterLink } from "#/components/common/router-links";
import { SectionHeading } from "#/components/common/section-heading";
import { Badge } from "#/components/glaze/ui/badge";
import {
	Item,
	ItemContent,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "#/components/glaze/ui/item";
import { SkeletonSwap, SkeletonText } from "#/components/glaze/ui/skeleton";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { myOrgsQueryOptions } from "#/lib/org.query";

const ROLE_LABEL = new Map([
	["admin", "Admin"],
	["member", "Member"],
]);

const ROW_SLOTS = ["a", "b"] as const;

function OrgRowsSkeleton() {
	return (
		<ItemGroup aria-hidden variant="plain">
			{ROW_SLOTS.map((slot) => (
				<Item key={slot}>
					<ItemContent>
						<SkeletonText className="w-40" type="label" />
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
	);
}

export function AccountOrgsPage({ onOpenOrg }: { onOpenOrg: () => void }) {
	const { data: orgs, isLoading } = useQuery(myOrgsQueryOptions());
	return (
		<section
			aria-labelledby="account-orgs-heading"
			className="flex flex-col gap-3"
		>
			<SectionHeading
				description="The orgs you belong to and your role in each."
				id="account-orgs-heading"
				title="Orgs"
			/>
			<SkeletonSwap
				fallback={<OrgRowsSkeleton />}
				label="Loading orgs"
				loading={isLoading}
			>
				<ItemGroup aria-label="Orgs" variant="plain">
					{(orgs ?? []).map((org) => (
						<Item key={org.id}>
							<ItemMedia>
								<OrgAvatar hue={org.avatarHue} name={org.name} />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>
									<ItemRouterLink
										onClick={onOpenOrg}
										params={{ org: org.slug }}
										to="/$org/home"
									>
										{org.name}
									</ItemRouterLink>
									{org.isPersonal ? (
										<Badge size="sm">Personal</Badge>
									) : (
										<Badge size="sm" variant="outline">
											{ROLE_LABEL.get(org.role) ?? org.role}
										</Badge>
									)}
								</ItemTitle>
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			</SkeletonSwap>
		</section>
	);
}
