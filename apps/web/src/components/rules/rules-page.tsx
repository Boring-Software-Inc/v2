import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { DashboardLayout } from "#/components/layouts/dashboard-layout";
import { RuleConfigForm } from "#/components/rules/rule-config-form";
import {
	repoOptionsQueryOptions,
	ruleConfigsQueryOptions,
} from "#/lib/rules.query";
import { MODERATOR } from "#/lib/site-config";

export function RulesPage() {
	const { data: repos } = useQuery(repoOptionsQueryOptions());
	const [selected, setSelected] = useState<string | null>(null);
	const repoId = selected ?? repos?.[0]?.id ?? "";
	const { data: rules } = useQuery(ruleConfigsQueryOptions(repoId));

	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<header className="mb-6 flex items-center justify-between gap-4">
					<div>
						<h1 className="font-semibold text-2xl tracking-tight">Rules</h1>
						<p className="text-muted-foreground text-sm">
							boolean requirements every non-exempt contributor must meet.
						</p>
					</div>
					{repos && repos.length > 0 ? (
						<select
							className="rounded-md border bg-card px-2 py-1.5 text-sm"
							onChange={(e) => setSelected(e.target.value)}
							value={repoId}
						>
							{repos.map((repo) => (
								<option key={repo.id} value={repo.id}>
									{repo.fullName}
								</option>
							))}
						</select>
					) : null}
				</header>
				{repos && repos.length === 0 ? (
					<div className="rounded-lg border border-dashed px-6 py-16 text-center text-muted-foreground text-sm">
						no repos yet — install the github app on a repo and its rules appear
						here.
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{rules?.map((rule) => (
							<RuleConfigForm key={rule.ruleId} repoId={repoId} rule={rule} />
						))}
					</div>
				)}
			</div>
		</DashboardLayout>
	);
}

export function RulesPageSkeleton() {
	return (
		<DashboardLayout counts={{}} moderator={MODERATOR}>
			<div className="mx-auto w-full max-w-3xl px-6 py-8">
				<div className="mb-6 h-8 w-40 animate-pulse rounded-md bg-surface-1" />
				<div className="flex flex-col gap-3">
					{Array.from({ length: 5 }, (_, i) => `rules-skel-${i}`).map((key) => (
						<div
							className="h-24 animate-pulse rounded-lg bg-surface-1"
							key={key}
						/>
					))}
				</div>
			</div>
		</DashboardLayout>
	);
}
