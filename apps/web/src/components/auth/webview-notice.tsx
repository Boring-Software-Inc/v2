import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#/components/glaze/ui/alert";
import { Input } from "#/components/glaze/ui/input";
import { webviewHostQueryOptions } from "#/lib/webview.query";

/**
 * Shown only inside an embedded browser (the X app and friends), where the
 * OAuth hop is likely to dead-end. Copy is the whole mechanism: the host app
 * owns navigation, so nothing we can call reliably hands the url to a real
 * browser. Detection is SSR'd off the request header.
 */
export function WebviewNotice() {
	const { data } = useQuery(webviewHostQueryOptions());
	const path = useRouterState({ select: (state) => state.location.href });

	if (!data?.host) {
		return null;
	}

	// Absolute, and built without `window` so the SSR pass renders the same card.
	const href = `${data.origin}${path}`;

	return (
		<Alert announce={false} status="warn">
			<AlertTitle>Sign-in may not work in this app</AlertTitle>
			<AlertDescription className="flex flex-col gap-2">
				<p>
					This app opened Tripwire in its built-in browser, which can block
					sign-in. Copy this link and open it in Safari, Chrome or Firefox.
				</p>
				<Input
					aria-label="Sign-in link"
					mode="copy"
					noun="sign-in link"
					size="sm"
					value={href}
				/>
			</AlertDescription>
		</Alert>
	);
}
