export interface ByteRange {
	start: number;
	end: number;
}

export function parseByteRange(
	header: string | null,
	size: number,
): ByteRange | "unsatisfiable" | null {
	if (!header) {
		return null;
	}
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) {
		return null;
	}
	const [, from, to] = match;
	if (from === "" && to === "") {
		return null;
	}
	if (from === "") {
		const suffix = Number(to);
		if (suffix === 0) {
			return "unsatisfiable";
		}
		return { start: Math.max(0, size - suffix), end: size - 1 };
	}
	const start = Number(from);
	const end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
	if (start >= size || start > end) {
		return "unsatisfiable";
	}
	return { start, end };
}

export function serveBytes(
	request: Request,
	bytes: Uint8Array<ArrayBuffer>,
	contentType: string,
	cacheControl: string,
): Response {
	const size = bytes.byteLength;
	const base = {
		"accept-ranges": "bytes",
		"cache-control": cacheControl,
		"content-type": contentType,
	};
	const range = parseByteRange(request.headers.get("range"), size);
	if (range === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: { ...base, "content-range": `bytes */${size}` },
		});
	}
	const head = request.method === "HEAD";
	if (range) {
		const length = range.end - range.start + 1;
		return new Response(head ? null : bytes.slice(range.start, range.end + 1), {
			status: 206,
			headers: {
				...base,
				"content-length": String(length),
				"content-range": `bytes ${range.start}-${range.end}/${size}`,
			},
		});
	}
	return new Response(head ? null : bytes, {
		status: 200,
		headers: { ...base, "content-length": String(size) },
	});
}
