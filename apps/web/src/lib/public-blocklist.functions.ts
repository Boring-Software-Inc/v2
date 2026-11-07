import { createServerFn } from "@tanstack/react-start";
import { sharedBlocklistPageQuerySchema } from "@tripwire/contracts";

export const getPublicSharedBlocklist = createServerFn({ method: "GET" })
	.inputValidator(sharedBlocklistPageQuerySchema)
	.handler(async ({ data }) => {
		const { loadPublishedSharedBlocklist } = await import(
			"@tripwire/utils/shared-blocklist"
		);
		const { getBlocklistRepositoryStars, pagePublicBlocklist } = await import(
			"#/lib/server/public-blocklist"
		);
		const [snapshot, stars] = await Promise.all([
			loadPublishedSharedBlocklist(),
			getBlocklistRepositoryStars(),
		]);
		return {
			stars,
			snapshot: snapshot ? pagePublicBlocklist(snapshot, data) : null,
		};
	});
