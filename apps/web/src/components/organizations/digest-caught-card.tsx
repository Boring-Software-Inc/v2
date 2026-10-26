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
import { useSetupInstallRules } from "#/components/setup/use-repo-setup";
import { useOrgPermission } from "#/hooks/use-org-permission";

interface DigestCaughtCardProps {
	org: string;
	caught: NonNullable<HomeDigest["caught"]>;
}

export function DigestCaughtCard({ org, caught }: DigestCaughtCardProps) {
	const canInstall = useOrgPermission(org, "rules:manage");
	const canActivate = useOrgPermission(org, "connections:manage");
	const { install, pending } = useSetupInstallRules({
		org,
		repo: caught.repoName,
		repoId: caught.repoId,
		armed: caught.armed,
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2 className="type-heading-sm">#{caught.number} got through</h2>
				</CardTitle>
				<CardDescription>
					{caught.ruleName} would have caught it.
				</CardDescription>
				{!caught.armed ? (
					<CardDescription>
						Tripwire is off on {caught.repoName}.{" "}
						{canActivate
							? "Installing this rule will turn it on."
							: "An org admin must turn on Tripwire for this repo before installing this rule."}
					</CardDescription>
				) : null}
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
				{canInstall && (caught.armed || canActivate) ? (
					<Button
						onClick={() =>
							install(caught.ruleId, caught.ruleName, [caught.ruleId])
						}
						pending={pending !== null}
						size="sm"
					>
						{caught.armed ? "Install" : "Turn on Tripwire and install"}{" "}
						{caught.ruleName}
					</Button>
				) : null}
			</CardFooter>
		</Card>
	);
}
