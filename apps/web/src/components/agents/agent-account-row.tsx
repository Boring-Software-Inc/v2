import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import { toast } from "#/components/glaze/ui/toast";
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

export const SIGN_OUT_FAILED = "Tripwire could not sign you out. Try again.";

export interface SwitchAccountSteps {
	signOut: () => Promise<boolean>;
	signIn: (callbackURL: string) => Promise<boolean>;
	go: (url: string) => void;
	fail: (message: string) => void;
}

export async function switchAccount(
	oauthQuery: string,
	steps: SwitchAccountSteps,
): Promise<boolean> {
	const targets = switchAccountTargets(oauthQuery);
	if (!(await steps.signOut())) {
		steps.fail(SIGN_OUT_FAILED);
		return false;
	}
	if (!(targets.resume && (await steps.signIn(targets.resume)))) {
		steps.go(targets.login);
	}
	return true;
}

const BROWSER_STEPS: SwitchAccountSteps = {
	signOut: () =>
		authClient.signOut().then(
			({ error }) => !error,
			() => false,
		),
	signIn: (callbackURL) =>
		authClient.signIn
			.social({
				provider: "github",
				callbackURL,
				additionalParams: { prompt: "select_account" },
			})
			.then(
				({ error }) => !error,
				() => false,
			),
	go: (url) => window.location.assign(url),
	fail: (message) => toast.fail(message),
};

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

	const startSwitch = async () => {
		setPending(true);
		if (!(await switchAccount(oauthQuery(), BROWSER_STEPS))) {
			setPending(false);
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
				onClick={() => void startSwitch()}
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
