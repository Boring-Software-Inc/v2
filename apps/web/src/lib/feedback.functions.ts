import { createServerFn } from "@tanstack/react-start";

/**
 * Ported from ~/tripwire's `@tripwire/feedback` server handler, adapted to v2's
 * server-function convention (no internal REST). The screenshot rides in as a
 * base64 data URL and is decoded here, then the whole thing is forwarded to a
 * Discord webhook (`FEEDBACK_WEBHOOK_URL`). No webhook set ⇒ a no-op that still
 * reports ok, so dev/self-host without the env doesn't error the form.
 */

export interface FeedbackElement {
	componentName: string | null;
	selector: string | null;
	htmlPreview?: string;
	stack: Array<{
		functionName: string | null;
		fileName: string | null;
		lineNumber: number | null;
		columnNumber: number | null;
	}>;
}

export interface FeedbackInput {
	comment: string;
	route: string;
	userAgent: string;
	prompt?: string;
	element?: FeedbackElement | null;
	metadata?: Record<string, string>;
	/** `data:image/png;base64,…` — captured client-side, optional. */
	screenshotDataUrl?: string | null;
}

const DISCORD_DESCRIPTION_MAX = 4096;
const DISCORD_FIELD_NAME_MAX = 256;
const DISCORD_FIELD_VALUE_MAX = 1024;
const DISCORD_FIELDS_MAX = 25;
const DISCORD_EMBED_TOTAL_CHARS_MAX = 6000;

function truncate(str: string, max: number): string {
	return str.length <= max ? str : `${str.slice(0, max - 3)}...`;
}

function dataUrlToBytes(dataUrl: string): ArrayBuffer | null {
	const comma = dataUrl.indexOf(",");
	if (comma === -1) {
		return null;
	}
	try {
		const buf = Buffer.from(dataUrl.slice(comma + 1), "base64");
		// Copy into a standalone ArrayBuffer so it's a valid BlobPart.
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

	const fields: Array<{ name: string; value: string; inline: boolean }> = [
		{
			name: "Route",
			value: truncate(data.route || "N/A", DISCORD_FIELD_VALUE_MAX),
			inline: false,
		},
	];

	if (data.element) {
		fields.push({
			name: "Component",
			value: data.element.componentName
				? truncate(
						`\`<${data.element.componentName} />\``,
						DISCORD_FIELD_VALUE_MAX,
					)
				: "`Unknown`",
			inline: true,
		});
		if (data.element.selector) {
			fields.push({
				name: "Selector",
				value: truncate(
					`\`${data.element.selector}\``,
					DISCORD_FIELD_VALUE_MAX,
				),
				inline: true,
			});
		}
		const stack = Array.isArray(data.element.stack) ? data.element.stack : [];
		const sourceFrame = stack[0];
		if (sourceFrame?.fileName) {
			const loc = `${sourceFrame.fileName}${sourceFrame.lineNumber ? `:${sourceFrame.lineNumber}` : ""}`;
			fields.push({
				name: "Source",
				value: truncate(`\`${loc}\``, DISCORD_FIELD_VALUE_MAX),
				inline: false,
			});
		}
		if (stack.length > 0) {
			const stackStr = stack
				.slice(0, 5)
				.map((f) => {
					const name = f.functionName || "anonymous";
					const file = f.fileName?.split("/").pop() ?? "?";
					const line = f.lineNumber ? `:${f.lineNumber}` : "";
					return `${name} (${file}${line})`;
				})
				.join("\n");
			fields.push({
				name: "Component Stack",
				value: truncate(`\`\`\`\n${stackStr}\n\`\`\``, DISCORD_FIELD_VALUE_MAX),
				inline: false,
			});
		}
	}

	if (data.prompt) {
		fields.push({
			name: "Suggested Fix Prompt",
			value: truncate(
				`\`\`\`\n${data.prompt}\n\`\`\``,
				DISCORD_FIELD_VALUE_MAX,
			),
			inline: false,
		});
	}

	if (data.metadata) {
		for (const [key, value] of Object.entries(data.metadata)) {
			fields.push({
				name: truncate(String(key), DISCORD_FIELD_NAME_MAX),
				value: truncate(String(value), DISCORD_FIELD_VALUE_MAX),
				inline: true,
			});
		}
	}

	fields.push({
		name: "Screenshot",
		value: screenshot ? "Attached" : "No",
		inline: true,
	});

	const embed: {
		title: string;
		description: string;
		color: number;
		fields: typeof fields;
		image?: { url: string };
		footer: { text: string };
		timestamp: string;
	} = {
		title: data.element?.componentName
			? truncate(`Feedback: ${data.element.componentName}`, 256)
			: "New User Feedback",
		description: truncate(data.comment, DISCORD_DESCRIPTION_MAX),
		color: 0x34_a6_ff,
		fields,
		...(screenshot ? { image: { url: "attachment://screenshot.png" } } : {}),
		footer: { text: "Tripwire Feedback" },
		timestamp: new Date().toISOString(),
	};

	// Clamp to Discord's field count + total-character ceilings.
	let totalChars =
		embed.title.length + embed.description.length + embed.footer.text.length;
	const finalFields: typeof fields = [];
	for (const field of fields.slice(0, DISCORD_FIELDS_MAX)) {
		const fieldChars = field.name.length + field.value.length;
		if (totalChars + fieldChars > DISCORD_EMBED_TOTAL_CHARS_MAX) {
			break;
		}
		totalChars += fieldChars;
		finalFields.push(field);
	}
	embed.fields = finalFields;

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
	.inputValidator((input: FeedbackInput) => input)
	.handler(async ({ data }): Promise<{ ok: boolean; forwarded: boolean }> => {
		if (!data.comment.trim()) {
			return { ok: false, forwarded: false };
		}
		const webhookUrl = process.env.FEEDBACK_WEBHOOK_URL;
		if (!webhookUrl) {
			console.warn("[feedback] FEEDBACK_WEBHOOK_URL unset — feedback dropped");
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
