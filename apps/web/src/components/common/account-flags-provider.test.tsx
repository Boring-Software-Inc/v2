import { expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountFlagsProvider } from "#/components/common/account-flags-provider";
import type { CurrentUser } from "#/lib/auth.functions";

const originalFetch = globalThis.fetch;

const USER: CurrentUser = {
	id: "fixture-account",
	name: "Account fixture",
	login: "account-fixture",
	forgeLogin: "account-fixture",
	email: "fixture@example.invalid",
	image: null,
};

for (const user of [undefined, null, USER]) {
	test(`does not evaluate flags while identity is pending: ${user?.id ?? String(user)}`, async () => {
		const fetch = spyOn(globalThis, "fetch").mockImplementation(
			Object.assign(async () => Response.json({ flags: {} }), {
				preconnect: originalFetch.preconnect,
			}),
		);
		try {
			const html = renderToStaticMarkup(
				<AccountFlagsProvider clientId="fixture-site" isPending user={user}>
					<p>Current page</p>
				</AccountFlagsProvider>,
			);
			await Bun.sleep(0);
			expect(html).toBe("<p>Current page</p>");
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			fetch.mockRestore();
		}
	});
}

test("the first flag evaluation already includes the authenticated account and existing login trait", async () => {
	const requests: URL[] = [];
	const fetch = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (input: Parameters<typeof globalThis.fetch>[0]) => {
				requests.push(
					new URL(input instanceof Request ? input.url : String(input)),
				);
				return Response.json({ flags: {} });
			},
			{ preconnect: originalFetch.preconnect },
		),
	);
	try {
		renderToStaticMarkup(
			<AccountFlagsProvider
				clientId="fixture-site"
				isPending={false}
				user={USER}
			>
				<p>Current page</p>
			</AccountFlagsProvider>,
		);
		await Bun.sleep(0);
		expect(requests).toHaveLength(1);
		const params = requests[0]?.searchParams;
		expect(params?.get("clientId")).toBe("fixture-site");
		expect(params?.get("userId")).toBe(USER.id);
		expect(params?.get("email")).toBe(USER.email);
		expect(JSON.parse(params?.get("properties") ?? "null")).toEqual({
			login: USER.login,
		});
	} finally {
		fetch.mockRestore();
	}
});
