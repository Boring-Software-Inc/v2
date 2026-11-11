import { useMutation, useQueryClient } from "@tanstack/react-query";
import { allowlistLoginSchema } from "@tripwire/contracts";
import { FormActions, FormSection } from "@tripwire/ui/layouts";
import { useId, useState } from "react";
import { Button } from "#/design-system/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "#/design-system/ui/field";
import { Input } from "#/design-system/ui/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "#/design-system/ui/item";
import { toast } from "#/design-system/ui/toast";
import {
	addRepoAllowlistLogin,
	removeRepoAllowlistAccount,
} from "#/lib/moderation-policy.functions";
import { repoModerationQueryOptions } from "#/lib/moderation-policy.query";

export function RepoAllowlist({
	org,
	repo,
	entries,
	canManage,
	onBrowseLibrary,
}: {
	org: string;
	repo: string;
	entries: readonly { accountId: string; login: string }[];
	canManage: boolean;
	onBrowseLibrary: () => void;
}) {
	const fieldId = useId();
	const [login, setLogin] = useState("");
	const [error, setError] = useState<string | null>(null);
	const client = useQueryClient();
	const { queryKey } = repoModerationQueryOptions(org, repo);
	const refresh = () => client.invalidateQueries({ queryKey });
	const add = useMutation({
		mutationFn: (username: string) =>
			addRepoAllowlistLogin({ data: { org, repo, login: username } }),
		onSuccess: async (result) => {
			if (result.status === "missing-account") {
				setError("GitHub couldn’t find that account.");
				return;
			}
			setLogin("");
			await refresh();
		},
		onError: () => setError("Couldn’t look up that GitHub account. Try again."),
	});
	const remove = useMutation({
		mutationFn: (accountId: string) =>
			removeRepoAllowlistAccount({ data: { org, repo, accountId } }),
		onSuccess: refresh,
		onError: () => toast.fail("Couldn’t remove the account. Try again."),
	});

	return (
		<FieldSet>
			<FieldLegend variant="label">Contributor allowlist</FieldLegend>
			<FieldDescription>
				Install Contributor allowlist from the Library to require approval for
				every author, including maintainers.
			</FieldDescription>
			<Button
				className="self-start"
				onClick={onBrowseLibrary}
				size="sm"
				variant="secondary"
			>
				View rule in Library
			</Button>
			{canManage && (
				<FormSection
					onSubmit={(event) => {
						event.preventDefault();
						if (add.isPending) return;
						const username = allowlistLoginSchema.safeParse(
							login.trim().replace(/^@/, ""),
						);
						if (!username.success) {
							setError("Enter a GitHub username.");
							return;
						}
						setError(null);
						add.mutate(username.data);
					}}
				>
					<Field className="min-w-36 flex-1" invalid={Boolean(error)}>
						<FieldLabel htmlFor={fieldId}>GitHub username</FieldLabel>
						<Input
							aria-describedby={error ? `${fieldId}-error` : undefined}
							autoComplete="off"
							disabled={add.isPending}
							id={fieldId}
							onChange={(event) => {
								setLogin(event.target.value);
								setError(null);
							}}
							value={login}
						/>
						{error && <FieldError id={`${fieldId}-error`}>{error}</FieldError>}
					</Field>
					<FormActions
						primary={
							<Button
								disabled={!login.trim() || add.isPending}
								type="submit"
								variant="secondary"
							>
								{add.isPending ? "Adding…" : "Add account"}
							</Button>
						}
					/>
				</FormSection>
			)}
			{entries.length > 0 ? (
				<ItemGroup aria-label="Approved GitHub accounts">
					{entries.map(({ accountId, login: username }) => (
						<Item key={accountId} size="sm">
							<ItemContent>
								<ItemTitle>@{username}</ItemTitle>
							</ItemContent>
							{canManage && (
								<ItemActions>
									<Button
										aria-label={`Remove @${username} from the allowlist`}
										disabled={remove.isPending}
										onClick={() => remove.mutate(accountId)}
										size="sm"
										variant="ghost"
									>
										Remove
									</Button>
								</ItemActions>
							)}
						</Item>
					))}
				</ItemGroup>
			) : (
				<FieldDescription>
					No approved accounts. If the rule is installed, every author fails
					this check.
				</FieldDescription>
			)}
		</FieldSet>
	);
}
