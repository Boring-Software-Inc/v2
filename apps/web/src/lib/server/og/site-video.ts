import siteVideo from "#/lib/server/og/assets/site.mp4?inline";
import { serveBytes } from "#/lib/server/og/byte-range";

const SITE_VIDEO = new Uint8Array(
	Buffer.from(siteVideo.slice(siteVideo.indexOf(",") + 1), "base64"),
);

export function handleSiteVideoRequest(request: Request): Response {
	return serveBytes(request, SITE_VIDEO, "video/mp4", "public, max-age=86400");
}
