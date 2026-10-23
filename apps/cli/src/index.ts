#!/usr/bin/env node
import { buildProgram, withDefaultCommand } from "#/program";
import { realSystem } from "#/system";

await buildProgram(realSystem()).parseAsync(
	withDefaultCommand(process.argv.slice(2)),
	{ from: "user" },
);
