import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { HomeDigest, OrgPermission } from "@tripwire/contracts";
import { notify } from "@tripwire/ui/toast";
import { generateId } from "@tripwire/utils";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DigestCaughtCard } from "#/components/organizations/digest-caught-card";
import * as armFunctions from "#/lib/arm.functions";
import { orgQueryKeys } from "#/lib/org.query";
import * as rulesFunctions from "#/lib/rules.functions";

const CAUGHT: NonNullable<HomeDigest["caught"]> = {
	repoId: generateId(),
	repoName: "lumen",
	armed: false,
	number: 521,
	title: "Update funding links",
	ruleId: "crypto-address",
	ruleName: "Crypto address",
	url: "https://github.com/lumenhq/lumen/pull/521",
};

const arm = spyOn(armFunctions, "armRepo");
const save = spyOn(rulesFunctions, "setRulesEnabled");
const show = spyOn(notify, "show");

afterAll(() => {
	for (const spy of [arm, save, show]) spy.mockRestore();
});

afterEach(() => {
	arm.mockReset();
	save.mockReset();
	show.mockReset();
});

function render(armed: boolean, permissions: OrgPermission[]) {
	const client = new QueryClient();
	client.setQueryData(orgQueryKeys.detail("lumenhq"), { permissions });
	const action = { click: null as (() => Promise<void>) | null };
	function findInstall(node: ReactNode): void {
		Children.forEach(node, (child) => {
			if (
				!isValidElement<{
					children?: ReactNode;
					onClick?: () => Promise<void>;
					onAction?: () => Promise<void>;
				}>(child)
			)
				return;
			if (child.props.onAction) action.click = child.props.onAction;
			else if (child.props.onClick) action.click = child.props.onClick;
			findInstall(child.props.children);
		});
	}
	function Probe() {
		const card = DigestCaughtCard({
			org: "lumenhq",
			caught: { ...CAUGHT, armed },
		});
		findInstall(card);
		return card;
	}
	const html = renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<Probe />
		</QueryClientProvider>,
	);
	return { html, click: action.click };
}

test("disarmed installation turns on the gate before saving the rule", async () => {
	const order: string[] = [];
	arm.mockImplementation(
		Object.assign(async () => {
			order.push("arm");
			return { armed: true, repoId: CAUGHT.repoId };
		}, armFunctions.armRepo),
	);
	save.mockImplementation(
		Object.assign(async () => {
			order.push("install");
			return { ok: true };
		}, rulesFunctions.setRulesEnabled),
	);
	show.mockImplementation(() => "toast");
	const { html, click } = render(false, ["rules:manage", "connections:manage"]);
	expect(html).toContain("Turn on Tripwire and install Crypto address");
	expect(click).not.toBeNull();
	await click?.();
	expect(order).toEqual(["arm", "install"]);
	expect(arm).toHaveBeenCalledWith({ data: { org: "lumenhq", repo: "lumen" } });
	expect(save).toHaveBeenCalledWith({
		data: {
			org: "lumenhq",
			repoId: CAUGHT.repoId,
			ruleIds: ["crypto-address"],
			enabled: true,
		},
	});
});

test("a refused activation never installs or announces success", async () => {
	arm.mockRejectedValue(new Error("permission denied"));
	show.mockImplementation(() => "toast");
	const { click } = render(false, ["rules:manage", "connections:manage"]);
	await click?.();
	expect(arm).toHaveBeenCalledTimes(1);
	expect(save).not.toHaveBeenCalled();
	expect(show).toHaveBeenCalledWith(
		{ title: "Only an org admin can turn on Tripwire for this repo." },
		"error",
	);
});

test("a queue initialization refusal offers retry without installing or announcing success", async () => {
	arm.mockResolvedValue({
		ok: false,
		armed: false,
		reason: "queue-unavailable",
		repoId: CAUGHT.repoId,
	});
	show.mockImplementation(() => "toast");
	const { click } = render(false, ["rules:manage", "connections:manage"]);
	await click?.();
	expect(save).not.toHaveBeenCalled();
	expect(show).toHaveBeenCalledWith(
		{ title: "Tripwire did not turn on. Try again in a moment." },
		"error",
	);
});

test("rule managers without activation permission see why an admin is required", () => {
	const { html, click } = render(false, ["rules:manage"]);
	expect(click).toBeNull();
	expect(html).toContain(
		"An org admin must turn on Tripwire for this repo before installing this rule.",
	);
});

test("an armed repo only needs rule management permission", async () => {
	save.mockResolvedValue({ ok: true });
	show.mockImplementation(() => "toast");
	const { html, click } = render(true, ["rules:manage"]);
	expect(html).toContain("Install Crypto address");
	await click?.();
	expect(arm).not.toHaveBeenCalled();
	expect(save).toHaveBeenCalledTimes(1);
});

test("readers cannot install on either armed state", () => {
	for (const armed of [false, true]) expect(render(armed, []).click).toBeNull();
});
