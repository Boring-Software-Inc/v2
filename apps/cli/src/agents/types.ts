import type { MergeOutcome } from "#/json-config";

export type SignInState = "signed-in" | "signed-out" | "unknown";

export interface LoginCommand {
	command: string;
	args: string[];
	status(): Promise<SignInState>;
}

export interface McpChange {
	target: string;
	outcome: MergeOutcome;
}

export interface Agent {
	readonly id: string;
	readonly name: string;
	readonly signInHint: string;
	detect(): boolean;
	hasServer(): Promise<boolean>;
	addServer(url: string): Promise<McpChange>;
	skillsDirs(): string[];
	login(): LoginCommand | null;
}
