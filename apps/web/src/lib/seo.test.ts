import { describe, expect, test } from "bun:test";
import { buildSeo, toAbsoluteUrl } from "#/lib/seo";

function tags(meta: ReturnType<typeof buildSeo>["meta"]) {
	const out: Record<string, string> = {};
	for (const tag of meta) {
		const key =
			"property" in tag ? tag.property : "name" in tag ? tag.name : null;
		if (key && "content" in tag && tag.content !== undefined) {
			out[key] = tag.content;
		}
	}
	return out;
}

describe("buildSeo", () => {
	test("the site page carries the fire loop next to the still image", () => {
		const head = tags(buildSeo({ path: "/" }).meta);
		const video = toAbsoluteUrl("/og.mp4");
		expect(head["og:image"]).toBe(toAbsoluteUrl("/og.png"));
		expect(head["og:video"]).toBe(video);
		expect(head["og:video:secure_url"]).toBe(video);
		expect(head["og:video:type"]).toBe("video/mp4");
		expect(head["og:video:width"]).toBe("1200");
		expect(head["og:video:height"]).toBe("630");
		expect(head["og:type"]).toBe("website");
		expect(head["twitter:card"]).toBe("summary_large_image");
		expect(head["twitter:image"]).toBe(toAbsoluteUrl("/og.png"));
	});

	test("a run page points both tags at its own hashed files", () => {
		const head = tags(
			buildSeo({
				path: "/runs/run-1",
				image: {
					path: "/og/runs/run-1/abc",
					video: "/og/runs/run-1/abc.mp4",
					width: 1200,
					height: 630,
				},
			}).meta,
		);
		expect(head["og:image"]).toBe(toAbsoluteUrl("/og/runs/run-1/abc"));
		expect(head["og:video"]).toBe(toAbsoluteUrl("/og/runs/run-1/abc.mp4"));
	});
});
