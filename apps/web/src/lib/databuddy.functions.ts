import { createServerFn } from "@tanstack/react-start";

export const getPublicDatabuddyConfig = createServerFn({
	method: "GET",
}).handler(async () => {
	const { getDatabuddyWebsiteId } = await import(
		"@tripwire/utils/databuddy-server"
	);
	return { databuddyWebsiteId: getDatabuddyWebsiteId() };
});
