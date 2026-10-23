import type { ReactNode } from "react";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ShaderDither } from "#/components/dither/shader-dither";

export function AgentRequestShell({ children }: { children: ReactNode }) {
	return (
		<div className="relative isolate flex min-h-dvh flex-col items-center justify-center bg-page px-4 pt-10 pb-40">
			<ShaderDither className="-z-10 top-auto h-40" mask="bottom" />
			<div className="flex w-full max-w-sm flex-col items-center gap-6">
				<BrandLockup />
				{children}
			</div>
		</div>
	);
}

export function AgentRequestHeader({
	title,
	subtitle,
}: {
	title: string;
	subtitle?: string;
}) {
	return (
		<header className="flex flex-col items-center gap-1.5 text-center">
			<h1 className="type-heading text-balance">{title}</h1>
			{subtitle ? (
				<p className="type-body-sm text-pretty text-text-2">{subtitle}</p>
			) : null}
		</header>
	);
}
