import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";

const whoamiSchema = z.discriminatedUnion("signedIn", [
	z.object({ signedIn: z.literal(false) }),
	z.object({
		signedIn: z.literal(true),
		email: z.string(),
		name: z.string(),
		orgs: z.array(
			z.object({ slug: z.string(), name: z.string(), role: z.string() }),
		),
	}),
]);

export type DevWhoami = z.infer<typeof whoamiSchema>;

export const devQueryKeys = {
	all: ["dev"] as const,
	whoami: () => [...devQueryKeys.all, "whoami"] as const,
};

async function fetchWhoami(signal: AbortSignal): Promise<DevWhoami | null> {
	const res = await fetch("/api/dev/whoami", { signal });
	if (!res.ok) {
		return null;
	}
	const parsed = whoamiSchema.safeParse(await res.json().catch(() => null));
	return parsed.success ? parsed.data : null;
}

export const devWhoamiQueryOptions = () =>
	queryOptions({
		queryKey: devQueryKeys.whoami(),
		queryFn: ({ signal }) => fetchWhoami(signal),
		staleTime: 30_000,
		retry: false,
	});
