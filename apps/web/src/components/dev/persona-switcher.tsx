import { useState } from "react";
import { toast } from "#/components/ui/toast";
import { PERSONAS, type PersonaId } from "#/lib/dev/personas";
import { cn } from "#/lib/utils";

/**
 * DEV persona switcher (§13) — a floating dev-only control (and an inline panel
 * on /login). One click seeds + signs in + routes to the persona's landing.
 * Rendered ONLY in a dev build: `import.meta.env.DEV` is a compile-time
 * constant, so this whole tree is dead-code-eliminated from production.
 */

async function post(path: string, body?: unknown): Promise<Response> {
	return await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
}

function usePersonaActions() {
	const [busy, setBusy] = useState<string | null>(null);

	async function pick(id: PersonaId): Promise<void> {
		setBusy(id);
		try {
			const res = await post("/api/dev/login", { persona: id });
			if (!res.ok) {
				const { error } = (await res.json().catch(() => ({}))) as {
					error?: string;
				};
				toast(error ?? "dev login failed");
				setBusy(null);
				return;
			}
			const { landing } = (await res.json()) as { landing: string };
			// Full document load so the session cookie + a fresh query cache apply.
			window.location.assign(landing);
		} catch (err) {
			toast(err instanceof Error ? err.message : "dev login failed");
			setBusy(null);
		}
	}

	async function reset(): Promise<void> {
		setBusy("reset");
		try {
			await post("/api/dev/reset");
			window.location.assign("/");
		} catch {
			toast("reset failed");
			setBusy(null);
		}
	}

	// Sign out and land on /login — the ONE path the §13 auto-login trampoline
	// leaves alone (__root.tsx). Anywhere else re-mints DEFAULT_PERSONA, so a
	// plain signOut appears not to "take". Full document load so the cleared
	// cookie applies before the route gate re-evaluates.
	async function logout(): Promise<void> {
		setBusy("logout");
		try {
			await post("/api/dev/logout");
			window.location.assign("/login");
		} catch {
			toast("logout failed");
			setBusy(null);
		}
	}

	return { busy, pick, reset, logout };
}

type PanelVariant = "list" | "grid";

/** The persona list — shared by the floating switcher and the /login panel. */
export function DevPersonaPanel({
	className,
	variant = "list",
}: {
	className?: string;
	variant?: PanelVariant;
}) {
	if (!import.meta.env.DEV) {
		return null;
	}
	return <PersonaList className={className} variant={variant} />;
}

function PersonaList({
	className,
	variant = "list",
	showLogout = false,
}: {
	className?: string;
	variant?: PanelVariant;
	showLogout?: boolean;
}) {
	const { busy, pick, reset, logout } = usePersonaActions();
	const grid = variant === "grid";
	return (
		<div
			className={cn(
				grid
					? "grid grid-cols-2 gap-1.5 text-left"
					: "flex flex-col gap-1 text-left",
				className,
			)}
		>
			{PERSONAS.map((persona) => (
				<button
					key={persona.id}
					type="button"
					disabled={busy !== null}
					onClick={() => pick(persona.id)}
					className={cn(
						"flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors",
						"hover:bg-surface-1 disabled:opacity-50",
						grid && "h-full border border-border/60",
						busy === persona.id && "bg-surface-1",
					)}
				>
					<span className="font-medium text-foreground text-xs">
						{persona.label}
					</span>
					<span
						className={cn(
							"text-[11px] text-muted-foreground",
							grid && "line-clamp-2",
						)}
					>
						{persona.description}
					</span>
				</button>
			))}
			<button
				type="button"
				disabled={busy !== null}
				onClick={() => reset()}
				className={cn(
					"rounded-md px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground disabled:opacity-50",
					grid ? "col-span-2 text-center" : "mt-1",
				)}
			>
				reset dev data
			</button>
			{showLogout ? (
				<button
					type="button"
					disabled={busy !== null}
					onClick={() => logout()}
					className={cn(
						"rounded-md px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground disabled:opacity-50",
						grid ? "col-span-2 text-center" : "",
					)}
				>
					{busy === "logout" ? "logging out…" : "log out → /login"}
				</button>
			) : null}
		</div>
	);
}

/** Floating switcher — mounts in the dashboard shell across the app. */
export function DevPersonaSwitcher() {
	const [open, setOpen] = useState(false);
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<div className="fixed bottom-3 left-3 z-50 print:hidden">
			{open ? (
				<div className="mb-2 w-64 overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg">
					<div className="flex items-center justify-between px-2 py-1">
						<span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
							dev personas
						</span>
						<button
							type="button"
							onClick={() => setOpen(false)}
							className="text-muted-foreground text-xs hover:text-foreground"
						>
							close
						</button>
					</div>
					<PersonaList showLogout />
				</div>
			) : null}
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"rounded-full border border-border bg-popover px-3 py-1.5 font-mono text-[11px] text-muted-foreground shadow-sm transition-colors",
					"hover:text-foreground",
				)}
			>
				dev
			</button>
		</div>
	);
}
