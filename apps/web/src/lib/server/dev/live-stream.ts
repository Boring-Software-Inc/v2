import { reposWithPermission } from "@tripwire/auth/org-gate";
import { LIVE_CHANNEL } from "@tripwire/contracts";
import { liveServices } from "@tripwire/db";

const HEARTBEAT_MS = 15_000;

/**
 * The demo head has no api process, so it serves the event stream itself
 * from the embedded Postgres. The agent channel goes through the same
 * message builder the api uses.
 */
export async function handleDevLiveStream(request: Request): Promise<Response> {
	const { getDb, getPglite } = await import("#/lib/server/db");
	const { getAuth } = await import("#/lib/server/auth");
	const { db } = getDb();
	const client = getPglite();
	if (!client) {
		return new Response("no embedded database", { status: 503 });
	}
	const session = await getAuth()?.api.getSession({
		headers: request.headers,
	});
	const userId = session?.user.id ?? null;
	const visible = async () =>
		userId
			? new Set(await reposWithPermission(db, userId, "activity:read"))
			: null;
	let repos = await visible();
	const encoder = new TextEncoder();
	let stop = () => {};
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const write = (event: string, data: string) => {
				try {
					controller.enqueue(
						encoder.encode(`event: ${event}\ndata: ${data}\n\n`),
					);
				} catch {
					stop();
				}
			};
			write("heartbeat", String(Date.now()));
			const unlisten = await client.listen(LIVE_CHANNEL, (payload) => {
				liveServices
					.liveMessageFor(db, payload, {
						userId,
						canSeeRepo: (name) => repos === null || repos.has(name),
					})
					.then((message) => {
						if (message) {
							write("agent", JSON.stringify(message));
						}
					})
					.catch(() => undefined);
			});
			const beat = setInterval(() => {
				write("heartbeat", String(Date.now()));
				visible()
					.then((next) => {
						repos = next;
					})
					.catch(() => undefined);
			}, HEARTBEAT_MS);
			stop = () => {
				clearInterval(beat);
				unlisten().catch(() => undefined);
				try {
					controller.close();
				} catch {}
			};
			request.signal.addEventListener("abort", () => stop());
		},
		cancel() {
			stop();
		},
	});
	return new Response(body, {
		headers: {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		},
	});
}
