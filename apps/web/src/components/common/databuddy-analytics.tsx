import { useEffect } from "react";

export function DatabuddyAnalytics({ websiteId }: { websiteId: string }) {
	useEffect(() => {
		if (document.querySelector("script[data-databuddy-injected]")) {
			return;
		}
		const script = document.createElement("script");
		script.src = "https://cdn.databuddy.cc/databuddy.v21.js";
		script.setAttribute("data-databuddy-injected", "true");
		script.setAttribute("data-client-id", websiteId);
		script.setAttribute("data-track-hash-changes", "true");
		script.setAttribute("data-track-attributes", "true");
		script.setAttribute("data-track-outgoing-links", "true");
		script.setAttribute("data-track-interactions", "true");
		script.setAttribute("data-track-web-vitals", "true");
		script.setAttribute("data-track-errors", "true");
		script.integrity =
			"sha384-m2c2os7/DpqI3ZXwXLHVY6KrzL/iLwn+yuxTPwZskc+miPMNHCWBfyTojAqMXl1";
		script.crossOrigin = "anonymous";
		script.async = true;
		document.head.appendChild(script);
		return () => script.remove();
	}, [websiteId]);
	return null;
}
