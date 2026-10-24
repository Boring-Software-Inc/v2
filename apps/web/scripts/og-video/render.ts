import { readFileSync, writeFileSync } from "node:fs";
import { renderSiteOgVideo } from "./site-og-video";

const root = new URL("../../", import.meta.url);
const out =
	process.argv[2] ??
	new URL("src/lib/server/og/assets/site.mp4", root).pathname;
const started = performance.now();
const mp4 = await renderSiteOgVideo(
	readFileSync(new URL("public/og.png", root)),
	readFileSync(new URL("fire-field.png", import.meta.url)),
);
writeFileSync(out, mp4);
console.log(
	`${out}: ${mp4.byteLength} bytes in ${Math.round(performance.now() - started)} ms`,
);
