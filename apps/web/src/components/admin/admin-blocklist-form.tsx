import { useMutation } from "@tanstack/react-query";
import { SHARED_BLOCKLIST_REPOSITORY } from "@tripwire/contracts";
import { AgentBoundary } from "@tripwire/ui/agent-policy";
import { Button } from "@tripwire/ui/button";
import {
	Field,
	FieldDescription,
	FieldLabel,
	Input,
	Textarea,
} from "@tripwire/ui/field";
import { Body } from "@tripwire/ui/typography";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { addSharedBlocklistAccount } from "#/lib/admin.functions";

const FAILURES = {
	"invalid-expiry": "Choose an expiry in the future.",
	"missing-account": "GitHub couldn't find that username.",
	unavailable: "Blocklist publishing isn't configured for this environment.",
	failed:
		"Tripwire couldn't confirm the request. Check GitHub Actions before retrying.",
};

export function AdminBlocklistForm() {
	const addition = useMutation({ mutationFn: addSharedBlocklistAccount });

	return (
		<Section id="admin-blocklist">
			<SectionHeader title="Add an account" />
			<SectionBody>
				<AgentBoundary visibility="hidden">
					<form
						data-layout-role="admin-blocklist-form"
						onSubmit={(event) => {
							event.preventDefault();
							const form = new FormData(event.currentTarget);
							const expiry = form.get("expiry");
							addition.mutate({
								data: {
									login: String(form.get("login")),
									reason: String(form.get("reason")),
									expiresAt: expiry ? `${expiry}T00:00:00Z` : null,
								},
							});
						}}
					>
						<Body>
							Verify the account and review the evidence before publishing. The
							username, reason, and expiry are public.
						</Body>
						<Field>
							<FieldLabel>GitHub username</FieldLabel>
							<Input
								labelledByField
								name="login"
								autoComplete="off"
								pattern="[A-Za-z0-9][A-Za-z0-9\x2d]*"
								maxLength={100}
								required
							/>
						</Field>
						<Field>
							<FieldLabel>Public reason</FieldLabel>
							<Textarea
								labelledByField
								name="reason"
								rows={3}
								maxLength={300}
								required
							/>
						</Field>
						<Field>
							<FieldLabel>Expiry date (optional, midnight UTC)</FieldLabel>
							<Input labelledByField type="date" name="expiry" />
							<FieldDescription>
								Leave blank to keep the listing active until it’s removed.
							</FieldDescription>
						</Field>
						<div data-layout-role="admin-blocklist-actions">
							<Button
								type="submit"
								disabled={addition.data?.status === "queued"}
								pending={addition.isPending}
								pendingLabel="Queueing…"
								reservePendingWidth
								variant="primary"
							>
								Publish account
							</Button>
							{addition.data?.status === "queued" ? (
								<Button
									type="reset"
									variant="secondary"
									onAction={() => addition.reset()}
								>
									Add another
								</Button>
							) : null}
						</div>
						{addition.data?.status === "queued" ? (
							<Body role="status">
								Addition queued.{" "}
								<a href={addition.data.url}>View the publish run on GitHub</a>.
							</Body>
						) : null}
						{addition.data && addition.data.status !== "queued" ? (
							<Body role="alert">
								{FAILURES[addition.data.status]}{" "}
								<a href={`${SHARED_BLOCKLIST_REPOSITORY}/actions`}>
									GitHub Actions
								</a>
							</Body>
						) : null}
						{addition.error ? (
							<Body role="alert">
								Check the username, reason and expiry, then try again.
							</Body>
						) : null}
					</form>
				</AgentBoundary>
			</SectionBody>
		</Section>
	);
}
