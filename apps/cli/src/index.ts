#!/usr/bin/env node
import { main } from "#/program";
import { realSystem } from "#/system";

await main(realSystem(), process.argv.slice(2));
