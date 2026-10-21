import { useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "#/components/glaze/ui/item";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/glaze/ui/popover";
import { toast } from "#/components/glaze/ui/toast";
import { PERSONAS, type PersonaId } from "#/lib/dev/personas";
import { cn } from "#/lib/glaze/utils";

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
				toast.fail(
					error ??
						"Couldn't sign in as that persona. Check the dev server log.",
				);
				setBusy(null);
				return;
			}
			const { landing } = (await res.json()) as { landing: string };
			// Full document load so the session cookie + a fresh query cache apply.
			window.location.assign(landing);
		} catch (err) {
			toast.fail(
				err instanceof Error
					? err.message
					: "Couldn't sign in as that persona. Check the dev server log.",
			);
			setBusy(null);
		}
	}

	async function reset(): Promise<void> {
		setBusy("reset");
		try {
			await post("/api/dev/reset");
			window.location.assign("/");
		} catch {
			toast.fail("Couldn't reset dev data. Check the dev server log.");
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
			toast.fail("Couldn't sign out. Try again.");
			setBusy(null);
		}
	}

	return { busy, pick, reset, logout };
}

/** The persona list — shared by the floating switcher and the /login panel. */
export function DevPersonaPanel({ className }: { className?: string }) {
	if (!import.meta.env.DEV) {
		return null;
	}
	return <PersonaList className={className} />;
}

function PersonaList({
	className,
	showLogout = false,
}: {
	className?: string;
	showLogout?: boolean;
}) {
	const { busy, pick, reset, logout } = usePersonaActions();
	return (
		<div className={cn("flex flex-col gap-2", className)}>
			<ItemGroup aria-label="Dev personas" variant="plain">
				{PERSONAS.map((persona) => (
					<Item key={persona.id}>
						<ItemContent>
							<ItemTitle>{persona.label}</ItemTitle>
							<ItemDescription>{persona.description}</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button
								aria-label={`Sign in as ${persona.label}`}
								disabled={busy !== null && busy !== persona.id}
								onClick={() => pick(persona.id)}
								pending={busy === persona.id}
								size="sm"
								variant="secondary"
							>
								Sign in
							</Button>
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
			<div className="flex flex-wrap gap-2">
				<Button
					disabled={busy !== null && busy !== "reset"}
					onClick={() => reset()}
					pending={busy === "reset"}
					size="sm"
					variant="secondary"
				>
					Reset dev data
				</Button>
				{showLogout ? (
					<Button
						disabled={busy !== null && busy !== "logout"}
						onClick={() => logout()}
						pending={busy === "logout"}
						size="sm"
						variant="secondary"
					>
						Sign out
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** Floating switcher — mounts in the dashboard shell across the app. */
export function DevPersonaSwitcher() {
	if (!import.meta.env.DEV) {
		return null;
	}
	return (
		<div className="fixed bottom-3 left-3 z-(--z-overlay) max-md:top-1/2 max-md:bottom-auto max-md:-translate-y-1/2 print:hidden">
			<Popover>
				<PopoverTrigger render={<Button size="sm" variant="secondary" />}>
					Dev
				</PopoverTrigger>
				<PopoverContent align="start" className="w-80" side="top">
					<PopoverHeader>
						<PopoverTitle>Dev personas</PopoverTitle>
					</PopoverHeader>
					<PersonaList showLogout />
				</PopoverContent>
			</Popover>
		</div>
	);
}
