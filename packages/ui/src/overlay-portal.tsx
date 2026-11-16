import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Renders overlays at the document root without introducing an SSR mismatch. */
export function OverlayPortal({ children }: { children: ReactNode }) {
	const [root, setRoot] = useState<HTMLElement | null>(null);

	useEffect(() => setRoot(document.body), []);

	return root ? createPortal(children, root) : children;
}
