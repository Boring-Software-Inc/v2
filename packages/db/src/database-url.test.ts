import { expect, test } from "bun:test";
import {
	assertPooledDatabaseUrl,
	assertSessionDatabaseUrl,
} from "./database-url.ts";

const direct = "postgresql://user:pw@us-east-3.pg.psdb.cloud:5432/postgres";
const pooled = "postgresql://user:pw@us-east-3.pg.psdb.cloud:6432/postgres";
const noPort = "postgresql://user:pw@us-east-3.pg.psdb.cloud/postgres";

test("production refuses PlanetScale's direct port for DATABASE_URL", () => {
	expect(() => assertPooledDatabaseUrl(direct, "production")).toThrow(
		"direct port 5432",
	);
	expect(() => assertPooledDatabaseUrl(noPort, "production")).toThrow(
		"direct port 5432",
	);
	expect(() => assertPooledDatabaseUrl(pooled, "production")).not.toThrow();
});

test("production refuses the pooled port for LISTEN connections", () => {
	expect(() => assertSessionDatabaseUrl(pooled, "production")).toThrow(
		"LISTEN needs the direct port",
	);
	expect(() => assertSessionDatabaseUrl(direct, "production")).not.toThrow();
});

test("local and test databases are left alone", () => {
	const local = "postgresql://tripwire:tripwire@localhost:5432/tripwire";
	expect(() => assertPooledDatabaseUrl(local, "production")).not.toThrow();
	expect(() => assertPooledDatabaseUrl(direct, "development")).not.toThrow();
	expect(() => assertPooledDatabaseUrl(direct, undefined)).not.toThrow();
	expect(() => assertSessionDatabaseUrl(pooled, "test")).not.toThrow();
});
