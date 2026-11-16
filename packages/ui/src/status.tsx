import type { ComponentProps, ReactNode } from "react";
import {
	FailedMark,
	Icon,
	type IconGlyph,
	Pending,
	Success,
	Waiting,
	Warning,
} from "./icon";

export type StatusValue =
	| "idle"
	| "queued"
	| "running"
	| "ok"
	| "warn"
	| "fail"
	| "waiting";

export const statuses = [
	"idle",
	"queued",
	"running",
	"ok",
	"warn",
	"fail",
	"waiting",
] as const satisfies readonly StatusValue[];

export const statusLabels = {
	idle: "Idle",
	queued: "Queued",
	running: "Running",
	ok: "Passed",
	warn: "Warning",
	fail: "Failed",
	waiting: "Waiting on you",
} satisfies Record<StatusValue, string>;

export const statusRank = {
	fail: 6,
	waiting: 5,
	warn: 4,
	running: 3,
	queued: 2,
	ok: 1,
	idle: 0,
} satisfies Record<StatusValue, number>;

const statusGlyph = {
	idle: null,
	queued: null,
	running: Pending,
	ok: Success,
	warn: Warning,
	fail: FailedMark,
	waiting: Waiting,
} satisfies Record<StatusValue, IconGlyph | null>;

function isSettled(status: StatusValue) {
	return (
		status === "ok" ||
		status === "warn" ||
		status === "fail" ||
		status === "waiting"
	);
}

export type StatusProps = Omit<ComponentProps<"span">, "children"> &
	(
		| { children?: string; live: true }
		| { children?: ReactNode; live?: false }
	) & {
		size?: "default" | "small";
		status?: StatusValue;
	};

export function Status({
	children,
	live,
	size = "default",
	status = "idle",
	...props
}: StatusProps) {
	const word = children ?? statusLabels[status];
	return (
		<span data-size={size} data-slot="status" data-status={status} {...props}>
			<StatusMark status={status} />
			<span
				aria-hidden={live && isSettled(status) ? true : undefined}
				data-slot="status-word"
			>
				{word}
			</span>
			{live ? (
				<span aria-live="polite" className="ui-sr-only">
					{isSettled(status) ? (children ?? statusLabels[status]) : ""}
				</span>
			) : null}
		</span>
	);
}

export interface StatusMarkProps
	extends Omit<ComponentProps<"span">, "children"> {
	label?: string;
	status?: StatusValue;
}

export function StatusMark({
	label,
	status = "idle",
	...props
}: StatusMarkProps) {
	const glyph = statusGlyph[status];
	if (!glyph) {
		return label ? (
			<span
				className="ui-sr-only"
				data-slot="status-mark"
				data-status={status}
				{...props}
			>
				{label}
			</span>
		) : null;
	}
	return (
		<span
			aria-hidden={label ? undefined : true}
			data-slot="status-mark"
			data-status={status}
			{...props}
		>
			<Icon
				icon={glyph}
				motion={status === "running" ? "spin" : undefined}
				size={12}
				weight={status === "running" ? "regular" : "bold"}
			/>
			{label ? <span className="ui-sr-only">{label}</span> : null}
		</span>
	);
}
