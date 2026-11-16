import { type ComponentProps, type ReactNode, useRef, useState } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

export type EmptyReason = "empty" | "error" | "no-access" | "no-results";

export interface EmptyStateProps extends ComponentProps<"div"> {
	art?: ReactNode;
	reason?: EmptyReason;
	size?: "sm" | "default";
	variant?: "panel" | "plain";
}

export function EmptyState({
	art,
	reason = "empty",
	size = "default",
	variant = "panel",
	children,
	role,
	...props
}: EmptyStateProps) {
	return (
		<div
			data-art={art ? "" : undefined}
			data-reason={reason}
			data-size={size}
			data-slot="empty-state"
			data-variant={variant}
			role={role ?? (reason === "error" ? "alert" : undefined)}
			{...props}
		>
			{art}
			{children}
		</div>
	);
}

export interface EmptyStateArtProps extends ComponentProps<"div"> {
	label?: string;
	size?: "compact" | "default";
	children?: ReactNode;
}

export function EmptyStateArt({
	label,
	size = "default",
	...props
}: EmptyStateArtProps) {
	if (label) {
		return (
			<div
				aria-label={label}
				data-size={size}
				data-slot="empty-state-art"
				role="img"
				{...props}
			/>
		);
	}
	return (
		<div
			aria-hidden="true"
			data-size={size}
			data-slot="empty-state-art"
			{...props}
		/>
	);
}

export function EmptyStateHeader(props: ComponentProps<"div">) {
	return <div data-slot="empty-state-header" {...props} />;
}

export function EmptyStateTitle({
	headingLevel = 3,
	...props
}: ComponentProps<"h3"> & { headingLevel?: 2 | 3 }) {
	const Heading = headingLevel === 2 ? "h2" : "h3";
	return <Heading data-slot="empty-state-title" {...props} />;
}

export function EmptyStateDescription(props: ComponentProps<"p">) {
	return <p data-slot="empty-state-description" {...props} />;
}

export function EmptyStateContent(props: ComponentProps<"div">) {
	return <div data-slot="empty-state-content" {...props} />;
}

export function EmptyStateCode(props: ComponentProps<"code">) {
	return <code data-slot="empty-state-code" {...props} />;
}

export interface EmptyStateRetryProps {
	ariaLabel?: string;
	children?: ReactNode;
	disabled?: boolean;
	onRetry: () => Promise<unknown>;
	size?: ButtonSize;
	variant?: Exclude<ButtonVariant, "destructive">;
}

export function EmptyStateRetry({
	children = "Retry",
	onRetry,
	...props
}: EmptyStateRetryProps) {
	const [pending, setPending] = useState(false);
	const [failure, setFailure] = useState<{ attempt: number; at: string }>();
	const attempts = useRef(0);
	return (
		<span data-slot="empty-state-retry">
			<Button
				{...props}
				disabled={pending || props.disabled}
				onAction={async () => {
					if (pending) return;
					setPending(true);
					try {
						await onRetry();
						setFailure(undefined);
					} catch {
						attempts.current += 1;
						setFailure({
							attempt: attempts.current,
							at: new Date().toLocaleTimeString("en-GB", {
								hour: "2-digit",
								minute: "2-digit",
								second: "2-digit",
							}),
						});
					} finally {
						setPending(false);
					}
				}}
			>
				{pending ? "Retrying" : children}
			</Button>
			{failure ? (
				<span aria-live="polite" data-slot="empty-state-retry-status">
					Retry {failure.attempt} failed at {failure.at}
				</span>
			) : null}
		</span>
	);
}
