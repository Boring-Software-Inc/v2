import { z } from "zod";

const SCREENSHOT_MAX_CHARS = 8_000_000;

export const feedbackElementSchema = z.object({
	name: z.string().trim().min(1).max(120),
	trail: z.array(z.string().max(120)).max(12),
	path: z.string().max(600),
	text: z.string().max(200).nullable(),
});

export const feedbackInputSchema = z.object({
	comment: z.string().trim().min(1).max(4000),
	route: z.string().max(500),
	userAgent: z.string().max(500),
	element: feedbackElementSchema.nullable().optional(),
	metadata: z.record(z.string(), z.string().max(200)).optional(),
	screenshotDataUrl: z
		.string()
		.startsWith("data:image/png;base64,")
		.max(SCREENSHOT_MAX_CHARS)
		.nullable()
		.optional(),
});

export type FeedbackElement = z.infer<typeof feedbackElementSchema>;
export type FeedbackInput = z.infer<typeof feedbackInputSchema>;

const DESCRIPTION_MAX = 4096;
const FIELD_NAME_MAX = 256;
const FIELD_VALUE_MAX = 1024;
const FIELDS_MAX = 25;
const EMBED_TOTAL_MAX = 6000;

export interface EmbedField {
	name: string;
	value: string;
	inline: boolean;
}

export interface FeedbackEmbed {
	title: string;
	description: string;
	color: number;
	fields: EmbedField[];
	image?: { url: string };
	footer: { text: string };
	timestamp: string;
}

function truncate(str: string, max: number): string {
	return str.length <= max ? str : `${str.slice(0, max - 3)}...`;
}

function code(value: string): string {
	return `\`${value.replaceAll("`", "'")}\``;
}

export function buildFeedbackEmbed(
	data: FeedbackInput,
	hasScreenshot: boolean,
	now: Date,
): FeedbackEmbed {
	const fields: EmbedField[] = [
		{
			name: "Route",
			value: truncate(data.route || "N/A", FIELD_VALUE_MAX),
			inline: false,
		},
	];

	const element = data.element ?? null;
	if (element) {
		fields.push({
			name: "Element",
			value: truncate(code(element.name), FIELD_VALUE_MAX),
			inline: true,
		});
		if (element.trail.length > 1) {
			fields.push({
				name: "Inside",
				value: truncate(code(element.trail.join(" > ")), FIELD_VALUE_MAX),
				inline: true,
			});
		}
		if (element.path) {
			fields.push({
				name: "DOM path",
				value: truncate(code(element.path), FIELD_VALUE_MAX),
				inline: false,
			});
		}
		if (element.text) {
			fields.push({
				name: "Text",
				value: truncate(element.text, FIELD_VALUE_MAX),
				inline: false,
			});
		}
	}

	for (const [key, value] of Object.entries(data.metadata ?? {})) {
		fields.push({
			name: truncate(key, FIELD_NAME_MAX),
			value: truncate(value, FIELD_VALUE_MAX),
			inline: true,
		});
	}

	fields.push({
		name: "Screenshot",
		value: hasScreenshot ? "Attached" : "No",
		inline: true,
	});

	const title = element
		? truncate(`Feedback: ${element.name}`, 256)
		: "New User Feedback";
	const description = truncate(data.comment, DESCRIPTION_MAX);
	const footer = { text: "Tripwire Feedback" };

	let total = title.length + description.length + footer.text.length;
	const kept: EmbedField[] = [];
	for (const field of fields.slice(0, FIELDS_MAX)) {
		const size = field.name.length + field.value.length;
		if (total + size > EMBED_TOTAL_MAX) {
			break;
		}
		total += size;
		kept.push(field);
	}

	const embed: FeedbackEmbed = {
		title,
		description,
		color: 0x34_a6_ff,
		fields: kept,
		footer,
		timestamp: now.toISOString(),
	};
	if (hasScreenshot) {
		embed.image = { url: "attachment://screenshot.png" };
	}
	return embed;
}
