import type { Agent, LoginCommand, SignInState } from "#/agents/types";
import type { RunResult } from "#/system";

export type SignInPlan =
	| { kind: "run"; agent: Agent; login: LoginCommand }
	| { kind: "signed-in"; agent: Agent }
	| { kind: "manual"; agent: Agent };

export type SignInOutcome = "signed-in" | "already" | "failed" | "manual";

export interface SignInResult {
	agent: Agent;
	outcome: SignInOutcome;
	login: LoginCommand | null;
}

export type RunLogin = (
	plan: Extract<SignInPlan, { kind: "run" }>,
) => Promise<RunResult>;

function probe(login: LoginCommand): Promise<SignInState> {
	return login.status().catch((): SignInState => "unknown");
}

export function planSignIns(agents: Agent[]): Promise<SignInPlan[]> {
	return Promise.all(
		agents.map(async (agent): Promise<SignInPlan> => {
			const login = agent.login();
			if (login === null) {
				return { kind: "manual", agent };
			}
			return (await probe(login)) === "signed-in"
				? { kind: "signed-in", agent }
				: { kind: "run", agent, login };
		}),
	);
}

async function signIn(
	plan: Extract<SignInPlan, { kind: "run" }>,
	run: RunLogin,
): Promise<SignInOutcome> {
	const result = await run(plan).catch(
		(): RunResult => ({ ok: false, stdout: "", stderr: "" }),
	);
	const state = await probe(plan.login);
	if (state === "unknown") {
		return result.ok ? "signed-in" : "failed";
	}
	return state === "signed-in" ? "signed-in" : "failed";
}

export async function runSignIns(
	plans: SignInPlan[],
	run: RunLogin,
): Promise<SignInResult[]> {
	const results: SignInResult[] = [];
	for (const plan of plans) {
		if (plan.kind === "run") {
			results.push({
				agent: plan.agent,
				outcome: await signIn(plan, run),
				login: plan.login,
			});
		} else {
			results.push({
				agent: plan.agent,
				outcome: plan.kind === "signed-in" ? "already" : "manual",
				login: null,
			});
		}
	}
	return results;
}
