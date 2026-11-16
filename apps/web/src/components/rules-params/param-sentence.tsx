import {
	formatParamValue,
	type JsonValue,
	type RuleParam,
	ruleUiSchema,
} from "@tripwire/contracts";
import { Button } from "@tripwire/ui/button";
import { Popover } from "@tripwire/ui/popover";
import { SupportingText } from "@tripwire/ui/typography";
import { Fragment, type ReactNode, useState } from "react";
import { ParamEditor } from "./param-editor";
import { ParamValue } from "./param-value";

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
	settingsScope,
}: {
	ruleId: string;
	config: JsonValue;
	canEdit: boolean;
	onSaveParam: (key: string, value: JsonValue) => void;
	className?: string;
	settingsScope?: { org: string; repo: string };
}) {
	const ui = ruleUiSchema(ruleId);
	const [editing, setEditing] = useState<string | null>(null);
	if (!ui || ui.params.length === 0) {
		return null;
	}
	const cfg =
		config === null || Array.isArray(config) || Object(config) !== config
			? {}
			: (config as Record<string, JsonValue>);
	const byKey = new Map(ui.params.map((p) => [p.key, p] as const));

	const renderValue = (param: RuleParam): ReactNode => {
		if (!canEdit) {
			return <ParamValue param={param} value={cfg[param.key]} />;
		}
		return (
			<Popover
				align="start"
				initialFocus={param.kind === "string-list" ? "none" : "auto"}
				open={editing === param.key}
				onOpenChange={(open) =>
					setEditing((current) =>
						open ? param.key : current === param.key ? null : current,
					)
				}
				title={param.label}
				trigger={
					<button
						aria-label={`Edit ${param.label}, now ${spokenValue(param, cfg[param.key])}`}
						className="cursor-pointer rounded-tag underline decoration-line-strong decoration-dotted underline-offset-3 transition-colors duration-(--dur-state) ease-out focus-sm hover:decoration-solid data-popup-open:decoration-solid"
						type="button"
					>
						<ParamValue param={param} value={cfg[param.key]} />
					</button>
				}
				triggerLabel={`Edit ${param.label}, now ${spokenValue(param, cfg[param.key])}`}
			>
				<ParamEditor
					onCancel={() => setEditing(null)}
					onSave={(value) => onSaveParam(param.key, value)}
					param={param}
					value={cfg[param.key]}
				/>
				{settingsScope && (
					<div className="self-start">
						<Button
							href={`/${encodeURIComponent(settingsScope.org)}/${encodeURIComponent(settingsScope.repo)}/rules/${encodeURIComponent(ruleId)}/settings`}
							size="small"
							variant="secondary"
						>
							Open settings
						</Button>
					</div>
				)}
			</Popover>
		);
	};

	return (
		<div className={className}>
			<SupportingText as="span">
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
			</SupportingText>
		</div>
	);
}
