import type { ReactNode } from "react";
import { BrandLockup } from "#/components/auth/brand-lockup";

export function AgentRequestShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-dvh w-full justify-center bg-page px-4 py-10 md:items-center">
			<div className="flex w-full max-w-md flex-col gap-6">
				<div className="flex justify-center">
					<BrandLockup />
				</div>
				{children}
			</div>
		</div>
	);
}

export function AgentRequestHeader({ title }: { title: string }) {
	return (
		<header className="flex flex-col items-center gap-2 text-center">
			<h1 className="type-title text-balance">{title}</h1>
		</header>
	);
}
