import type { ReactNode } from "react";
import { BrandLockup } from "#/components/auth/brand-lockup";
import { ShaderDither } from "#/components/dither/shader-dither";

export function AgentRequestShell({ children }: { children: ReactNode }) {
	return (
		<div data-layout-role="agent-request-shell">
			<ShaderDither className="agent-request-dither" mask="bottom" />
			<div data-layout-role="agent-request-content">
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
		<header data-layout-role="agent-request-header">
			<h1>{title}</h1>
			{subtitle ? <p>{subtitle}</p> : null}
		</header>
	);
}
