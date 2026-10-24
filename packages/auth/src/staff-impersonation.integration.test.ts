import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	applyMigrations,
	createDb,
	createTestDatabase,
	type Db,
	schema,
	staffAuditServices,
	staffUserServices,
	type TestDatabase,
} from "@tripwire/db";
import { eq } from "drizzle-orm";
import { createAuth } from "./server.ts";
import {
	IMPERSONATION_REFUSED,
	IMPERSONATION_SECONDS,
	impersonationBlocksPermission,
	impersonationRefusal,
} from "./staff-impersonation.ts";

let container: TestDatabase;
let db: Db;
let pool: { end(): Promise<void> };
let auth: ReturnType<typeof createAuth>;

const BASE = "http://localhost:3000";

function cookieHeader(headers: Headers, previous = ""): string {
	const jar = new Map<string, string>();
	for (const part of previous.split("; ").filter(Boolean)) {
		const [name, ...rest] = part.split("=");
		if (name) {
			jar.set(name, rest.join("="));
		}
	}
	for (const line of headers.getSetCookie()) {
		const [pair] = line.split(";");
		const [name, ...rest] = (pair ?? "").split("=");
		if (!name) {
			continue;
		}
		const value = rest.join("=");
		const expired = /max-age=0/i.test(line) || value === "";
		if (expired) {
			jar.delete(name);
		} else {
			jar.set(name, value);
		}
	}
	return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function signUp(
	email: string,
	name: string,
): Promise<{ id: string; cookie: string }> {
	const res = await auth.api.signUpEmail({
		body: { email, password: "tripwire-dev-persona", name },
		asResponse: true,
	});
	expect(res.ok).toBe(true);
	const cookie = cookieHeader(res.headers);
	const session = await auth.api.getSession({
		headers: new Headers({ cookie }),
	});
	if (!session) {
		throw new Error("no session after sign-up");
	}
	return { id: session.user.id, cookie };
}

function headersFor(cookie: string): Headers {
	return new Headers({ cookie, origin: BASE });
}

let staff: { id: string; cookie: string };
let otherStaff: { id: string; cookie: string };
let mara: { id: string; cookie: string };

beforeAll(async () => {
	container = await createTestDatabase();
	({ db, pool } = createDb(container.url));
	await applyMigrations(db);
	auth = createAuth({
		db,
		secret: "test-secret-please-ignore-0123456789",
		baseUrl: BASE,
		github: null,
		opengit: null,
		devLogin: true,
	});
	staff = await signUp("grim@tripwire.demo", "grim");
	otherStaff = await signUp("ops@tripwire.demo", "ops");
	mara = await signUp("mara@lumenlabs.dev", "Mara Okafor");
	await db
		.update(schema.user)
		.set({ isPlatformAdmin: true })
		.where(eq(schema.user.id, staff.id));
	await db
		.update(schema.user)
		.set({ isPlatformAdmin: true })
		.where(eq(schema.user.id, otherStaff.id));
}, 120_000);

afterAll(async () => {
	await pool?.end().catch(() => undefined);
	await container?.stop();
});

describe("impersonationRefusal", () => {
	const plain = { isPlatformAdmin: false, role: null, banned: false };
	test("allows only plain, unbanned, other users", () => {
		expect(
			impersonationRefusal({ actorId: "a", targetId: "b", target: plain }),
		).toBeNull();
		expect(
			impersonationRefusal({ actorId: "a", targetId: "a", target: plain }),
		).toBe("self");
		expect(
			impersonationRefusal({ actorId: "a", targetId: "b", target: null }),
		).toBe("missing");
		expect(
			impersonationRefusal({
				actorId: "a",
				targetId: "b",
				target: { ...plain, isPlatformAdmin: true },
			}),
		).toBe("staff");
		expect(
			impersonationRefusal({
				actorId: "a",
				targetId: "b",
				target: { ...plain, role: "user, admin" },
			}),
		).toBe("admin-role");
		expect(
			impersonationRefusal({
				actorId: "a",
				targetId: "b",
				target: { ...plain, banned: true },
			}),
		).toBe("banned");
	});

	test("org security permissions are blocked while impersonating", () => {
		expect(impersonationBlocksPermission("members:manage")).toBe(true);
		expect(impersonationBlocksPermission("settings:manage")).toBe(true);
		expect(impersonationBlocksPermission("connections:manage")).toBe(true);
		expect(impersonationBlocksPermission("rules:manage")).toBe(false);
		expect(impersonationBlocksPermission("activity:read")).toBe(false);
	});
});

describe("staff impersonation endpoint", () => {
	test("a non-staff user cannot impersonate anyone", async () => {
		const attempt = await auth.api
			.staffImpersonateUser({
				body: { userId: staff.id },
				headers: headersFor(mara.cookie),
			})
			.catch((error: unknown) => error);
		expect(attempt).toMatchObject({ status: "NOT_FOUND" });
	});

	test("staff cannot impersonate other staff or themselves", async () => {
		for (const target of [otherStaff.id, staff.id]) {
			const attempt = await auth.api
				.staffImpersonateUser({
					body: { userId: target },
					headers: headersFor(staff.cookie),
				})
				.catch((error: unknown) => error);
			expect(attempt).toBeInstanceOf(Error);
		}
		const sessions = await db
			.select()
			.from(schema.session)
			.where(eq(schema.session.impersonatedBy, staff.id));
		expect(sessions).toHaveLength(0);
	});

	test("staff impersonate a user, are fenced in, then stop", async () => {
		const started = await auth.api.staffImpersonateUser({
			body: { userId: mara.id },
			headers: headersFor(staff.cookie),
			returnHeaders: true,
		});
		const asMara = cookieHeader(started.headers, staff.cookie);
		const session = await auth.api.getSession({ headers: headersFor(asMara) });
		expect(session?.user.id).toBe(mara.id);
		expect(
			await staffUserServices.getSessionImpersonator(
				db,
				session?.session.id ?? "",
			),
		).toBe(staff.id);
		const expiresIn =
			new Date(session?.session.expiresAt ?? 0).getTime() - Date.now();
		expect(expiresIn).toBeLessThanOrEqual(IMPERSONATION_SECONDS * 1000);
		expect(expiresIn).toBeGreaterThan((IMPERSONATION_SECONDS - 60) * 1000);

		const audit = await staffAuditServices.listStaffAuditForUser(db, mara.id);
		expect(audit[0]).toMatchObject({
			actorId: staff.id,
			action: "impersonation.start",
		});

		const nested = await auth.api
			.staffImpersonateUser({
				body: { userId: otherStaff.id },
				headers: headersFor(asMara),
			})
			.catch((error: unknown) => error);
		expect(String(nested)).toContain(IMPERSONATION_REFUSED);

		const changeName = await auth.api
			.updateUser({ body: { name: "Hijacked" }, headers: headersFor(asMara) })
			.catch((error: unknown) => error);
		expect(String(changeName)).toContain(IMPERSONATION_REFUSED);

		const revokeAll = await auth.api
			.revokeSessions({ headers: headersFor(asMara) })
			.catch((error: unknown) => error);
		expect(String(revokeAll)).toContain(IMPERSONATION_REFUSED);

		const stopped = await auth.api.stopImpersonating({
			headers: headersFor(asMara),
			returnHeaders: true,
		});
		const back = cookieHeader(stopped.headers, asMara);
		const restored = await auth.api.getSession({ headers: headersFor(back) });
		expect(restored?.user.id).toBe(staff.id);

		const stillOpen = await db
			.select()
			.from(schema.session)
			.where(eq(schema.session.impersonatedBy, staff.id));
		expect(stillOpen).toHaveLength(0);

		const [row] = await db
			.select({ name: schema.user.name })
			.from(schema.user)
			.where(eq(schema.user.id, mara.id));
		expect(row?.name).toBe("Mara Okafor");
	});

	test("a banned user cannot be impersonated", async () => {
		await staffUserServices.banUser(db, {
			userId: mara.id,
			reason: "Spam",
			expires: null,
		});
		const attempt = await auth.api
			.staffImpersonateUser({
				body: { userId: mara.id },
				headers: headersFor(staff.cookie),
			})
			.catch((error: unknown) => error);
		expect(String(attempt)).toContain("Unban");
		await staffUserServices.unbanUser(db, mara.id);
	});
});
