import { expect, test } from "bun:test";
import {
	gitCafeConnectionRepositorySchema,
	gitCafeInstallationCreatedSchema,
	gitCafeLifecycleEventSchema,
	gitCafeOrganizationMembersSchema,
	gitCafeRepositoriesUpdatedSchema,
} from "@tripwire/contracts";
import members from "../fixtures/gitcafe-connection-members.json";
import repository from "../fixtures/gitcafe-connection-repository.json";
import created from "../fixtures/gitcafe-installation-created.json";
import updated from "../fixtures/gitcafe-installation-repositories-updated.json";
import uninstalled from "../fixtures/gitcafe-installation-uninstalled.json";

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

test("provider-held staging selection change and uninstall parse without claiming live receipt", () => {
	expect(gitCafeRepositoriesUpdatedSchema.parse(updated)).toMatchObject({
		type: "installation.repositories_updated",
		repositorySelection: "selected",
		previousRepositorySelection: "all",
	});
	expect(gitCafeLifecycleEventSchema.parse(uninstalled)).toMatchObject({
		type: "installation.uninstalled",
		installation: { id: "ins_01m60z0mpmfffbfjmwdvzfjp6b" },
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
