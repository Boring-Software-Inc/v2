import { useState } from "react";
import { DevPersonaPanel } from "#/components/dev/persona-switcher";
import { Button } from "#/components/ui/button";

/**
 * Dev-only persona switcher, collapsed into its own bubble under the login
 * card so it doesn't compete with the sign-in button. Same card construction
 * as the login card (§9): surface-2 shell, surface-1 well.
 */
export function DevPersonaDisclosure() {
	const [open, setOpen] = useState(false);
	return (
		<div className="mt-2 w-[334px] max-w-full shrink-0 overflow-clip rounded-[10px] border border-border bg-surface-2 p-1">
			<Button
				aria-expanded={open}
				className="h-auto w-full justify-between px-3 py-1.5 text-[11px] text-muted-foreground uppercase tracking-wide hover:text-foreground"
				iconRight={<span aria-hidden>{open ? "−" : "+"}</span>}
				onClick={() => setOpen((o) => !o)}
				variant="ghost"
			>
				dev personas
			</Button>
			{open ? (
				<div className="mt-1 rounded-sm border border-border bg-surface-1 p-2">
					<DevPersonaPanel variant="grid" />
				</div>
			) : null}
		</div>
	);
}
