import type { HomeDigest } from "@tripwire/contracts";
import { Button } from "#/components/glaze/ui/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardMeta,
	CardTitle,
} from "#/components/glaze/ui/card";
import { useInstallRules } from "#/components/rules/use-install-rules";
import { useOrgPermission } from "#/hooks/use-org-permission";

interface DigestCaughtCardProps {
	org: string;
	caught: NonNullable<HomeDigest["caught"]>;
}

export function DigestCaughtCard({ org, caught }: DigestCaughtCardProps) {
	const canInstall = useOrgPermission(org, "rules:manage");
	const { install, pending } = useInstallRules(org, caught.repoId);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="type-heading-sm">#{caught.number} got through</h2>
				</CardTitle>
				<CardDescription>
					{caught.ruleName} would have caught it.
				</CardDescription>
			</CardHeader>
			<CardFooter className="flex-wrap">
				<CardMeta className="basis-full sm:basis-auto">{caught.title}</CardMeta>
				<Button
					nativeButton={false}
					render={
						<a
							aria-label={`Open #${caught.number}`}
							href={caught.url}
							rel="noreferrer"
							target="_blank"
						>
							Open #{caught.number}
						</a>
					}
					size="sm"
					variant="secondary"
				>
					Open #{caught.number}
				</Button>
				{canInstall ? (
					<Button
						onClick={() =>
							install(caught.ruleId, caught.ruleName, [caught.ruleId])
						}
						pending={pending !== null}
						size="sm"
					>
						Install {caught.ruleName}
					</Button>
				) : null}
			</CardFooter>
		</Card>
	);
}
