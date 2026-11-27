import { expect, test } from "bun:test";
import { createDb, createDirectPool } from "./client.ts";

// No connection is opened: pg connects on the first query.
const url = "postgresql://tripwire:tripwire@localhost:1/tripwire";

test("a database restart that drops idle connections doesn't kill the process", async () => {
	const { pool } = createDb(url);
	const direct = createDirectPool(url);
	const dropped = new Error(
		"terminating connection due to administrator command",
	);
	expect(() => pool.emit("error", dropped)).not.toThrow();
	expect(() => direct.emit("error", dropped)).not.toThrow();
	await Promise.all([pool.end(), direct.end()]);
});
