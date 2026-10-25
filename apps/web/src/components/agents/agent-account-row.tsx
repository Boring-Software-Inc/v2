import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import { authClient } from "#/lib/auth-client";
import { oauthAuthorizeResume } from "#/lib/oauth-resume";

export function switchAccountTargets(oauthQuery: string): {
	resume: string | null;
	login: string;
} {
	const search = Object.fromEntries(new URLSearchParams(oauthQuery));
	return {
		resume: oauthAuthorizeResume(search),
		login: `/login?${oauthQuery}`,
	};
}

export function AgentAccountRow({
	name,
	forgeLogin,
	oauthQuery,
}: {
	name: string;
	forgeLogin: string | null;
	oauthQuery: () => string;
}) {
	const [pending, setPending] = useState(false);

	const switchAccount = async () => {
		setPending(true);
		const targets = switchAccountTargets(oauthQuery());
		await authClient.signOut().catch(() => undefined);
		if (!targets.resume) {
			window.location.assign(targets.login);
			return;
		}
		const { error } = await authClient.signIn.social({
			provider: "github",
			callbackURL: targets.resume,
			additionalParams: { prompt: "select_account" },
		});
		if (error) {
			window.location.assign(targets.login);
		}
	};

	return (
		<div className="flex w-full items-center gap-3 px-1">
			<p className="min-w-0 flex-1 truncate type-body-sm text-text-2">
				Signed in as{" "}
				<span className="text-text-1">
					{forgeLogin ? `@${forgeLogin}` : name}
				</span>
			</p>
			<Button
				onClick={() => void switchAccount()}
				pending={pending}
				size="sm"
				type="button"
				variant="ghost"
			>
				Use another account
			</Button>
		</div>
	);
}
