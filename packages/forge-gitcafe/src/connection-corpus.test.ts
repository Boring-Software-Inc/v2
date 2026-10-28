import { expect, test } from "bun:test";
import {
	gitCafeConnectionRepositorySchema,
	gitCafeOrganizationMembersSchema,
} from "@tripwire/contracts";
import members from "../fixtures/gitcafe-connection-members.json";
import repository from "../fixtures/gitcafe-connection-repository.json";

test("authorized staging membership and repository captures parse", () => {
	expect(gitCafeOrganizationMembersSchema.parse(members).items[0]?.role).toBe(
		"org-owner",
	);
	expect(gitCafeConnectionRepositorySchema.parse(repository)).toMatchObject({
		owner: "boring",
		name: "scratch",
		id: repository.id,
	});
});
