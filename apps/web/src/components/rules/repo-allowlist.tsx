import { useMutation, useQueryClient } from "@tanstack/react-query";
import { allowlistLoginSchema } from "@tripwire/contracts";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	initialsOf,
} from "@tripwire/ui/avatar";
import { Button } from "@tripwire/ui/button";
import { Field, FieldError, FieldSet, Input } from "@tripwire/ui/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemGroup,
	ItemTitle,
} from "@tripwire/ui/item";
import { ActionRow } from "@tripwire/ui/layouts";
import { notify } from "@tripwire/ui/toast";
import { useId, useRef, useState } from "react";
import {
	EmptyState,
	EmptyStateDescription,
	EmptyStateHeader,
	EmptyStateTitle,
} from "#/components/common/empty-state";
import { MascotArt } from "#/components/mascot/mascot-art";
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
}: {
	org: string;
	repo: string;
	entries: readonly { accountId: string; login: string }[];
	canManage: boolean;
}) {
	const fieldId = useId();
	const inputRef = useRef<HTMLInputElement>(null);
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
		onSuccess: async () => {
			await refresh();
			inputRef.current?.focus();
		},
		onError: () =>
			notify.show(
				{ title: "Couldn’t remove the account. Try again." },
				"error",
			),
	});

	return (
		<FieldSet legend="Approved GitHub accounts">
			{canManage && (
				<form
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
					<ActionRow
						secondary={
							<div className="min-w-36 flex-1">
								<Field invalid={Boolean(error)}>
									<Input
										ariaLabel="GitHub username"
										data-layout-role="allowlist-username"
										placeholder="GitHub username"
										autoComplete="off"
										disabled={add.isPending}
										id={fieldId}
										onChange={(event) => {
											setLogin(event.target.value);
											setError(null);
										}}
										ref={inputRef}
										value={login}
									/>
									{error ? <FieldError>{error}</FieldError> : null}
								</Field>
							</div>
						}
						primary={
							<div className="self-end">
								<Button
									disabled={!login.trim() || add.isPending}
									type="submit"
									variant="secondary"
								>
									{add.isPending ? "Adding…" : "Add account"}
								</Button>
							</div>
						}
					/>
				</form>
			)}
			{entries.length > 0 ? (
				<ItemGroup aria-label="Approved GitHub accounts">
					{entries.map(({ accountId, login: username }) => {
						return (
							<Item key={accountId} density="compact">
								<Avatar decorative name={username} size="sm">
									<AvatarImage
										alt=""
										referrerPolicy="no-referrer"
										src={
											"https://avatars.githubusercontent.com/u/" +
											encodeURIComponent(accountId) +
											"?s=64"
										}
									/>
									<AvatarFallback>{initialsOf(username, "sm")}</AvatarFallback>
								</Avatar>
								<ItemContent>
									<ItemTitle>@{username}</ItemTitle>
								</ItemContent>
								{canManage && (
									<ItemActions>
										<Button
											ariaLabel={`Remove @${username} from the allowlist`}
											confirmation={{
												confirmLabel: "Remove account",
												description: `@${username} will no longer be approved for this repository.`,
												title: `Remove @${username}?`,
											}}
											disabled={remove.isPending}
											onAction={() => remove.mutate(accountId)}
											pending={remove.isPending}
											size="small"
											variant="destructive"
										>
											Remove
										</Button>
									</ItemActions>
								)}
							</Item>
						);
					})}
				</ItemGroup>
			) : (
				<EmptyState art={<MascotArt mood="rules-empty" />}>
					<EmptyStateHeader>
						<EmptyStateTitle>No approved accounts</EmptyStateTitle>
						<EmptyStateDescription>
							Every author fails this check until you add an account.
						</EmptyStateDescription>
					</EmptyStateHeader>
				</EmptyState>
			)}
		</FieldSet>
	);
}
