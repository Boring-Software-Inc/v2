import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orgSlugSchema, slugifyOrgName } from "@tripwire/contracts";
import { Avatar } from "@tripwire/ui/avatar";
import { Badge } from "@tripwire/ui/badge";
import { Button } from "@tripwire/ui/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
} from "@tripwire/ui/field";
import { Add, Check, Icon } from "@tripwire/ui/icon";
import { ONBOARDING_COPY } from "#/components/onboarding/onboarding-copy";
import { useOnboardingDraft } from "#/components/onboarding/onboarding-draft";
import { OnboardingStepHeader } from "#/components/onboarding/onboarding-frame";
import type { StepViewProps } from "#/components/onboarding/onboarding-steps";
import { HomePreview } from "#/components/onboarding/preview/home-preview";
import { usePreviewUser } from "#/components/onboarding/preview/preview-app";
import { OrgAvatar } from "#/components/organizations/org-avatar";
import { useDebouncedValue } from "#/hooks/use-debounced-value";
import { orgSlugCheckQueryOptions } from "#/lib/onboarding-flow.query";
import { createOrg } from "#/lib/org.functions";
import { myOrgsQueryOptions, orgQueryKeys } from "#/lib/org.query";

const copy = ONBOARDING_COPY.workspace;

function useWorkspaceSlug() {
	const [draft] = useOnboardingDraft();
	const slug =
		draft.workspaceSlug ||
		(draft.workspaceName.trim() ? slugifyOrgName(draft.workspaceName) : "");
	const valid = orgSlugSchema.safeParse(slug).success;
	const debounced = useDebouncedValue(slug, 250);
	const check = useQuery({
		...orgSlugCheckQueryOptions(debounced),
		enabled: valid && debounced.length > 0,
	});
	const status =
		slug.length === 0
			? null
			: !valid
				? "invalid"
				: debounced !== slug || check.isPending
					? "checking"
					: check.isError
						? "unchecked"
						: (check.data?.status ?? "checking");
	return { slug, status } as const;
}

/**
 * Step 3, for teams: name the workspace. The avatar rerolls from the name,
 * the slug follows the name until edited, and availability is checked as
 * they type. A personal user skips this and keeps their personal workspace.
 */
export function WorkspaceStep({ flow }: StepViewProps) {
	const queryClient = useQueryClient();
	const [draft, update] = useOnboardingDraft();
	const { slug, status } = useWorkspaceSlug();
	const existing =
		flow.state.orgSlug && flow.state.orgSlug !== flow.state.personalOrgSlug
			? flow.state.orgSlug
			: null;
	const create = useMutation({
		mutationFn: () =>
			createOrg({ data: { name: draft.workspaceName.trim(), slug } }),
		onSuccess: (result) => {
			if ("slug" in result) {
				void queryClient.invalidateQueries({ queryKey: orgQueryKeys.all });
				flow.advance({ org: result.slug });
			}
		},
	});
	const failed =
		create.isError || (create.data !== undefined && "error" in create.data);
	// A failed availability check doesn't block: createOrg refuses a taken slug.
	const canCreate =
		draft.workspaceName.trim().length > 0 &&
		(status === "available" || status === "unchecked");

	if (existing) {
		return (
			<>
				<OnboardingStepHeader
					current={flow.step}
					steps={flow.steps}
					sub={copy.sub}
					title={copy.title}
				/>
				<p data-layout-role="onboarding-note">{copy.livesAt(existing)}</p>
				<Button onAction={() => flow.advance()} size="large" variant="primary">
					{ONBOARDING_COPY.continue}
				</Button>
			</>
		);
	}

	return (
		<>
			<OnboardingStepHeader
				current={flow.step}
				steps={flow.steps}
				sub={copy.sub}
				title={copy.title}
			/>
			<form
				data-layout-role="onboarding-fields"
				onSubmit={(event) => {
					event.preventDefault();
					if (canCreate && !create.isPending) {
						create.mutate();
					}
				}}
			>
				<Field>
					<FieldLabel>{copy.name}</FieldLabel>
					<Input
						autoFocus
						labelledByField
						leadingIcon={
							<OrgAvatar animate name={draft.workspaceName} size="xs" />
						}
						onChange={(event) => update({ workspaceName: event.target.value })}
						placeholder="Acme"
						value={draft.workspaceName}
					/>
					<FieldDescription>{copy.avatarNote}</FieldDescription>
				</Field>
				<Field invalid={status === "invalid" || status === "taken"}>
					<FieldLabel>{copy.slug}</FieldLabel>
					<div data-layout-role="onboarding-slug">
						<span aria-hidden="true" data-part="prefix">
							{copy.slugPrefix}
						</span>
						<Input
							labelledByField
							onChange={(event) =>
								update({ workspaceSlug: event.target.value.toLowerCase() })
							}
							placeholder="acme"
							value={slug}
						/>
						{status === "available" ? (
							<output data-part="status">
								<Icon icon={Check} size={12} />
								{copy.available}
							</output>
						) : null}
					</div>
					{status === "invalid" ? (
						<FieldError>{copy.slugInvalid}</FieldError>
					) : status === "taken" ? (
						<FieldError>{copy.slugTaken}</FieldError>
					) : (
						<FieldDescription>{copy.livesAt(slug || "acme")}</FieldDescription>
					)}
				</Field>
				{failed ? (
					<p data-layout-role="onboarding-error" role="alert">
						{create.data && "error" in create.data
							? create.data.error
							: copy.createFailed}
					</p>
				) : null}
				<Button
					disabled={!canCreate}
					pending={create.isPending}
					size="large"
					type="submit"
					variant="primary"
				>
					{copy.create}
				</Button>
			</form>
		</>
	);
}

/**
 * The account menu, open and enlarged over the dimmed home, gaining the new
 * workspace as it is named.
 */
export function WorkspacePreview({ flow }: StepViewProps) {
	const [draft] = useOnboardingDraft();
	const user = usePreviewUser();
	const { slug } = useWorkspaceSlug();
	const { data: orgs } = useQuery(myOrgsQueryOptions());
	const personal = orgs?.find((org) => org.isPersonal);
	// A workspace made earlier in onboarding shows as itself; until then the
	// menu follows what is typed.
	const existing = orgs?.find(
		(org) => !org.isPersonal && org.slug === flow.state.orgSlug,
	);
	const name = existing?.name ?? (draft.workspaceName.trim() || "Acme");
	// The personal workspace row holds its place while the list loads, so the
	// menu never grows under the pointer.
	const personalName =
		personal?.name ?? (flow.state.personalOrgSlug ? user.name : null);
	return (
		<HomePreview
			org={existing?.slug ?? (slug || "acme")}
			overlay={
				<>
					<div data-layout-role="onboarding-preview-scrim" />
					<div data-layout-role="onboarding-menu-callout">
						<div data-part="menu">
							<div data-part="group">
								<span data-part="label">Active workspace</span>
								<div data-part="item" data-current="true">
									<OrgAvatar hue={existing?.avatarHue} name={name} size="sm" />
									<span data-part="name">{name}</span>
									<Icon icon={Check} size={14} />
								</div>
							</div>
							<div data-part="group">
								<span data-part="label">Other workspaces</span>
								{personalName ? (
									<div data-part="item">
										<OrgAvatar
											hue={personal?.avatarHue}
											name={personalName}
											size="sm"
										/>
										<span data-part="name">{personalName}</span>
										<Badge size="small" variant="outline">
											Personal
										</Badge>
									</div>
								) : null}
								<div data-part="item">
									<Icon icon={Add} size={16} />
									<span data-part="name">Create org</span>
								</div>
							</div>
							<div data-part="group">
								<div data-part="item">
									<Avatar
										decorative
										name={user.name}
										src={user.image || undefined}
									/>
									<span data-part="text">
										<span data-part="name">{user.name}</span>
										{user.identity ? (
											<span data-part="description">{user.identity}</span>
										) : null}
									</span>
								</div>
							</div>
						</div>
						<div data-part="trigger">
							<Avatar
								decorative
								name={user.name}
								src={user.image || undefined}
							/>
							<span data-part="name">{user.name}</span>
						</div>
					</div>
				</>
			}
		/>
	);
}
