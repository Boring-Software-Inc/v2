import type { MergeOutcome } from "#/json-config";

export interface LoginCommand {
	command: string;
	args: string[];
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
