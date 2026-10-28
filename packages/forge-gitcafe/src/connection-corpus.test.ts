import { expect, test } from "bun:test";
import {
	gitCafeConnectionRepositorySchema,
	gitCafeInstallationCreatedSchema,
	gitCafeOrganizationMembersSchema,
} from "@tripwire/contracts";
import members from "../fixtures/gitcafe-connection-members.json";
import repository from "../fixtures/gitcafe-connection-repository.json";
import created from "../fixtures/gitcafe-installation-created.json";

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

test("authorized provider-held installation.created payload parses without claiming live receipt", () => {
	expect(gitCafeInstallationCreatedSchema.parse(created)).toMatchObject({
		type: "installation.created",
		installation: created.installation,
		repositorySelection: "selected",
		repositories: created.repositories,
	});
});
