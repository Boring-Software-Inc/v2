import { Button as InlineTrigger } from "@base-ui/react/button";
import {
	formatParamValue,
	type RuleParam,
	ruleUiSchema,
} from "@tripwire/contracts";
import { Fragment, type ReactNode, useState } from "react";
import { cn } from "#/lib/glaze/utils";
import { ParamEditor } from "./param-editor";
import { ParamValue } from "./param-value";

/**
 * A rule's config as human sentences (§9) — the templates read as one paragraph, each value
 * rendered inline via `ParamValue`. When `canEdit`, a value is a button that
 * swaps to `ParamEditor` in place; otherwise it's static text. Params not named
 * in any sentence (e.g. ai-review's advanced `model`) never render here. Returns
 * null for a param-less rule, so the card shows no config region at all.
 */
function spokenValue(
	param: RuleParam,
	value: Parameters<typeof formatParamValue>[1],
): string {
	if (param.kind === "string-list") {
		const items = Array.isArray(value)
			? (value as string[])
			: [...param.default];
		return items.length > 0 ? items.join(", ") : "empty";
	}
	return formatParamValue(param, value);
}

export function ParamSentence({
	ruleId,
	config,
	canEdit,
	onSaveParam,
	className,
}: {
	ruleId: string;
	config: unknown;
	canEdit: boolean;
	onSaveParam: (key: string, value: unknown) => void;
	className?: string;
}) {
	const ui = ruleUiSchema(ruleId);
	const [editing, setEditing] = useState<string | null>(null);
	if (!ui || ui.params.length === 0) {
		return null;
	}
	const cfg = (
		typeof config === "object" && config !== null ? config : {}
	) as Record<string, unknown>;
	const byKey = new Map(ui.params.map((p) => [p.key, p] as const));

	const renderValue = (param: RuleParam): ReactNode => {
		if (editing === param.key) {
			return (
				<ParamEditor
					onCancel={() => setEditing(null)}
					onSave={(value) => {
						setEditing(null);
						onSaveParam(param.key, value);
					}}
					param={param}
					value={cfg[param.key]}
				/>
			);
		}
		if (!canEdit) {
			return <ParamValue param={param} value={cfg[param.key]} />;
		}
		return (
			<InlineTrigger
				aria-label={`Change ${param.label}, now ${spokenValue(param, cfg[param.key])}`}
				className="cursor-pointer rounded-tag text-text-1 underline decoration-text-3 decoration-dotted underline-offset-3 transition-[text-decoration-color] duration-(--dur-state) ease-out focus-sm hover:decoration-text-1"
				onClick={() => setEditing(param.key)}
			>
				<ParamValue param={param} value={cfg[param.key]} />
			</InlineTrigger>
		);
	};

	return (
		<div
			className={cn(
				"type-body-sm text-text-2",
				className,
				editing && "line-clamp-none",
			)}
		>
			{ui.sentences.map((sentence, index) => (
				<Fragment key={sentence}>
					{index > 0 ? "; " : null}
					{sentence.split(/(\{\w+\})/).map((part, i) => {
						const match = /^\{(\w+)\}$/.exec(part);
						const param = match ? byKey.get(match[1] as string) : undefined;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed template segments
							<Fragment key={i}>{param ? renderValue(param) : part}</Fragment>
						);
					})}
				</Fragment>
			))}
		</div>
	);
}
