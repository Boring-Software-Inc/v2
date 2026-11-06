import { describe, expect, test } from "bun:test";
import { CommanderError } from "commander";
import { buildProgram } from "#/program";
import { realSystem } from "#/system";

const system = realSystem({}, "linux");

describe("program parsing", () => {
	test("Commander rejects unknown commands", async () => {
		const program = buildProgram(system).exitOverride();
		program.configureOutput({ writeErr: () => undefined });
		const error = await program
			.parseAsync(["instal"], { from: "user" })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CommanderError);
		expect((error as CommanderError).code).toBe("commander.unknownCommand");
	});

	test("Commander rejects invalid flags instead of swallowing them", async () => {
		const program = buildProgram(system).exitOverride();
		program.configureOutput({ writeErr: () => undefined });
		const error = await program
			.parseAsync(["--no-interactive"], { from: "user" })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CommanderError);
		expect((error as CommanderError).code).toBe("commander.unknownOption");
	});

	test("command groups print their own help and complete successfully", async () => {
		for (const group of ["rules", "gate", "workflows", "runs", "queue"]) {
			let stdout = "";
			const program = buildProgram(system).exitOverride();
			const groupCommand = program.commands.find(
				(command) => command.name() === group,
			);
			expect(groupCommand).toBeDefined();
			groupCommand?.configureOutput({
				writeOut: (value) => {
					stdout += value;
				},
			});
			await program.parseAsync([group], { from: "user" });
			expect(stdout).toContain(`Usage: tripwire ${group}`);
		}
	});
});
