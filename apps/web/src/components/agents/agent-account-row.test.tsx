import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AgentAccountRow,
	SIGN_OUT_FAILED,
	type SwitchAccountSteps,
	switchAccount,
	switchAccountTargets,
} from "#/components/agents/agent-account-row";

const SIGNED =
	"response_type=code&client_id=claude-code&redirect_uri=http%3A%2F%2Flocalhost%3A5555%2Fcallback&scope=openid+tripwire%3Aread&state=s1&exp=1999999999&sig=abc";

describe("switchAccountTargets", () => {
	test("resumes the same authorize request without the signature", () => {
		const { resume, login } = switchAccountTargets(SIGNED);
		expect(resume).toStartWith("/api/auth/oauth2/authorize?");
		const params = new URLSearchParams(resume?.split("?")[1]);
		expect(params.get("client_id")).toBe("claude-code");
		expect(params.get("state")).toBe("s1");
		expect(params.has("sig")).toBe(false);
		expect(params.has("exp")).toBe(false);
		expect(login).toBe(`/login?${SIGNED}`);
	});

	test("an unsigned query falls back to the sign-in page", () => {
		expect(switchAccountTargets("client_id=x").resume).toBeNull();
	});
});

function recorder(outcome: { signOut: boolean; signIn: boolean }) {
	const calls: string[] = [];
	const steps: SwitchAccountSteps = {
		signOut: async () => {
			calls.push("signOut");
			return outcome.signOut;
		},
		signIn: async (callbackURL) => {
			calls.push(`signIn ${callbackURL.split("?")[0]}`);
			return outcome.signIn;
		},
		go: (url) => calls.push(`go ${url.split("?")[0]}`),
		fail: (message) => calls.push(`fail ${message}`),
	};
	return { calls, steps };
}

describe("switchAccount", () => {
	test("signs out, then starts GitHub sign-in back to the same request", async () => {
		const { calls, steps } = recorder({ signOut: true, signIn: true });
		expect(await switchAccount(SIGNED, steps)).toBe(true);
		expect(calls).toEqual(["signOut", "signIn /api/auth/oauth2/authorize"]);
	});

	test("a failed sign-out stops before GitHub sign-in and says so", async () => {
		const { calls, steps } = recorder({ signOut: false, signIn: true });
		expect(await switchAccount(SIGNED, steps)).toBe(false);
		expect(calls).toEqual(["signOut", `fail ${SIGN_OUT_FAILED}`]);
	});

	test("a failed GitHub sign-in after sign-out goes to the sign-in page", async () => {
		const { calls, steps } = recorder({ signOut: true, signIn: false });
		expect(await switchAccount(SIGNED, steps)).toBe(true);
		expect(calls).toEqual([
			"signOut",
			"signIn /api/auth/oauth2/authorize",
			"go /login",
		]);
	});
});

describe("AgentAccountRow", () => {
	test("names the signed-in GitHub login and offers another account", () => {
		const html = renderToStaticMarkup(
			<AgentAccountRow
				forgeLogin="old-account"
				name="Old Account"
				oauthQuery={() => SIGNED}
			/>,
		);
		expect(html).toContain("Signed in as");
		expect(html).toContain("@old-account");
		expect(html).toContain("Use another account");
	});

	test("an account with no forge login shows its name without an @", () => {
		const html = renderToStaticMarkup(
			<AgentAccountRow
				forgeLogin={null}
				name="Dev owner"
				oauthQuery={() => SIGNED}
			/>,
		);
		expect(html).toContain("Dev owner");
		expect(html).not.toContain("@Dev owner");
	});
});
