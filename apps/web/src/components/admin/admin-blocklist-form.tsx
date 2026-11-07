import { useMutation } from "@tanstack/react-query";
import { SHARED_BLOCKLIST_REPOSITORY } from "@tripwire/contracts";
import {
	Section,
	SectionBody,
	SectionHeader,
} from "#/components/layouts/section";
import { Button } from "#/design-system/ui/button";
import { Body } from "#/design-system/ui/typography";
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
			<SectionHeader title="Shared spam blocklist" />
			<SectionBody>
				<form
					data-layout-role="admin-blocklist-form"
					onSubmit={(event) => {
						event.preventDefault();
						const form = new FormData(event.currentTarget);
						addition.mutate({
							data: {
								login: String(form.get("login")),
								reason: String(form.get("reason")),
								expiresAt: `${form.get("expiry")}T00:00:00Z`,
							},
						});
					}}
				>
					<Body>
						Verify the account before publishing. The username, reason and
						expiry will be public on GitHub.
					</Body>
					<label data-layout-role="admin-blocklist-field">
						GitHub username
						<input
							className="field"
							name="login"
							autoComplete="off"
							pattern="[A-Za-z0-9][A-Za-z0-9\x2d]*"
							maxLength={100}
							required
						/>
					</label>
					<label data-layout-role="admin-blocklist-field">
						Public reason
						<textarea
							name="reason"
							className="field"
							rows={3}
							maxLength={300}
							required
						/>
					</label>
					<label data-layout-role="admin-blocklist-field">
						Expires at midnight UTC
						<input className="field" type="date" name="expiry" required />
					</label>
					<div data-layout-role="public-blocklist-search">
						<Button
							type="submit"
							disabled={
								addition.isPending || addition.data?.status === "queued"
							}
						>
							{addition.isPending ? "Queueing…" : "Publish account"}
						</Button>
						{addition.data?.status === "queued" ? (
							<Button
								type="reset"
								variant="secondary"
								onClick={() => addition.reset()}
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
			</SectionBody>
		</Section>
	);
}
