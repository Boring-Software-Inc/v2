import { useMutation, useQueryClient } from "@tanstack/react-query";
import { allowlistLoginSchema } from "@tripwire/contracts";
import { ActionRow } from "@tripwire/ui/layouts";
import { motion, useReducedMotion } from "motion/react";
import { useId, useRef, useState } from "react";
import { MascotArt } from "#/components/mascot/mascot-art";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
	initialsOf,
} from "#/design-system/ui/avatar";
import { Button } from "#/design-system/ui/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/design-system/ui/empty-state";
import {
	Field,
	FieldError,
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

const RemoveButton = motion.create(Button);

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
	const confirmRef = useRef<HTMLButtonElement>(null);
	const [login, setLogin] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const reduceMotion = useReducedMotion();
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
			setConfirming(null);
			inputRef.current?.focus();
		},
		onError: () => toast.fail("Couldn’t remove the account. Try again."),
	});

	return (
		<FieldSet>
			<FieldLegend variant="label">Approved GitHub accounts</FieldLegend>
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
							<Field className="min-w-36 flex-1" invalid={Boolean(error)}>
								<Input
									aria-label="GitHub username"
									data-layout-role="allowlist-username"
									placeholder="GitHub username"
									aria-describedby={error ? `${fieldId}-error` : undefined}
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
								{error && (
									<FieldError id={`${fieldId}-error`}>{error}</FieldError>
								)}
							</Field>
						}
						primary={
							<Button
								className="self-end"
								disabled={!login.trim() || add.isPending}
								type="submit"
								variant="secondary"
							>
								{add.isPending ? "Adding…" : "Add account"}
							</Button>
						}
					/>
				</form>
			)}
			{entries.length > 0 ? (
				<ItemGroup aria-label="Approved GitHub accounts">
					{entries.map(({ accountId, login: username }) => {
						const confirm = confirming === accountId;
						return (
							<Item key={accountId} size="sm">
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
										{confirm && (
											<Button
												aria-label={`Cancel removal of @${username}`}
												disabled={remove.isPending}
												onClick={() => {
													confirmRef.current?.focus();
													setConfirming(null);
												}}
												size="sm"
												variant="ghost"
											>
												Cancel
											</Button>
										)}
										<RemoveButton
											animate={{
												scale: confirm && !reduceMotion ? [1, 1.06, 1] : 1,
											}}
											aria-label={
												(confirm ? "Confirm removal of @" : "Remove @") +
												username +
												" from the allowlist"
											}
											disabled={remove.isPending}
											onClick={() =>
												confirm
													? remove.mutate(accountId)
													: setConfirming(accountId)
											}
											onKeyDown={(event) => {
												if (
													event.key === "Escape" &&
													confirm &&
													!remove.isPending
												)
													setConfirming(null);
											}}
											size="sm"
											ref={confirm ? confirmRef : undefined}
											transition={{ duration: 0.18 }}
											variant={confirm ? "destructive" : "ghost"}
										>
											{confirm ? "Confirm removal" : "Remove"}
										</RemoveButton>
									</ItemActions>
								)}
							</Item>
						);
					})}
				</ItemGroup>
			) : (
				<Empty art={<MascotArt mood="rules-empty" />}>
					<EmptyHeader>
						<EmptyTitle>No approved accounts</EmptyTitle>
						<EmptyDescription>
							Every author fails this check until you add an account.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
		</FieldSet>
	);
}
