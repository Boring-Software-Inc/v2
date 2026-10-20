import { type RuleParam, ruleUiSchema } from "@tripwire/contracts";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "#/components/glaze/ui/button";
import { ParamEditor } from "./param-editor";
import { ParamValue } from "./param-value";

/**
 * A rule's config as human sentences (§9) — one line per template, each value
 * rendered inline via `ParamValue`. When `canEdit`, a value is a button that
 * swaps to `ParamEditor` in place; otherwise it's static text. Params not named
 * in any sentence (e.g. ai-review's advanced `model`) never render here. Returns
 * null for a param-less rule, so the card shows no config region at all.
 */
export function ParamSentence({
	ruleId,
	config,
	canEdit,
	onSaveParam,
}: {
	ruleId: string;
	config: unknown;
	canEdit: boolean;
	onSaveParam: (key: string, value: unknown) => void;
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
			<Button
				onClick={() => setEditing(param.key)}
				size="sm"
				variant="secondary"
			>
				<ParamValue param={param} value={cfg[param.key]} />
			</Button>
		);
	};

	return (
		<div className="flex flex-col gap-1">
			{ui.sentences.map((sentence) => (
				<p className="type-body-sm text-text-2" key={sentence}>
					{sentence.split(/(\{\w+\})/).map((part, i) => {
						const match = /^\{(\w+)\}$/.exec(part);
						const param = match ? byKey.get(match[1] as string) : undefined;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed template segments
							<Fragment key={i}>{param ? renderValue(param) : part}</Fragment>
						);
					})}
				</p>
			))}
		</div>
	);
}
