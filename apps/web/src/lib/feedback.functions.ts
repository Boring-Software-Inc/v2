import { createServerFn } from "@tanstack/react-start";
import {
	buildFeedbackEmbed,
	type FeedbackInput,
	feedbackInputSchema,
} from "#/lib/feedback-payload";
import { accessGuardMiddleware } from "#/lib/server/gated-server-fn";

function dataUrlToBytes(dataUrl: string): ArrayBuffer | null {
	const comma = dataUrl.indexOf(",");
	if (comma === -1) {
		return null;
	}
	try {
		const buf = Buffer.from(dataUrl.slice(comma + 1), "base64");
		const ab = new ArrayBuffer(buf.byteLength);
		new Uint8Array(ab).set(buf);
		return ab;
	} catch {
		return null;
	}
}

async function sendToDiscord(
	webhookUrl: string,
	data: FeedbackInput,
): Promise<boolean> {
	const screenshot = data.screenshotDataUrl
		? dataUrlToBytes(data.screenshotDataUrl)
		: null;
	const embed = buildFeedbackEmbed(data, screenshot !== null, new Date());

	const form = new FormData();
	form.append(
		"payload_json",
		JSON.stringify({ username: "Tripwire Feedback", embeds: [embed] }),
	);
	if (screenshot) {
		form.append(
			"file",
			new Blob([screenshot], { type: "image/png" }),
			"screenshot.png",
		);
	}

	const res = await fetch(webhookUrl, { method: "POST", body: form });
	if (!res.ok) {
		console.error(`[feedback] Discord webhook error: ${res.statusText}`);
	}
	return res.ok;
}

export const submitFeedback = createServerFn({ method: "POST" })
	.middleware([accessGuardMiddleware])
	.inputValidator((input: FeedbackInput) => feedbackInputSchema.parse(input))
	.handler(async ({ data }): Promise<{ ok: boolean; forwarded: boolean }> => {
		const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
		if (!webhookUrl) {
			console.warn("[feedback] FEEDBACK_WEBHOOK_URL unset, feedback dropped");
			return { ok: true, forwarded: false };
		}
		try {
			const forwarded = await sendToDiscord(webhookUrl, data);
			return { ok: forwarded, forwarded };
		} catch (error) {
			console.error("[feedback] failed to forward:", error);
			return { ok: false, forwarded: false };
		}
	});
