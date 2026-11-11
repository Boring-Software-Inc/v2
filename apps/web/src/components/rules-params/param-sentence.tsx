import { Link } from "@tanstack/react-router";
import {
	formatParamValue,
	type JsonValue,
	type RuleParam,
	ruleUiSchema,
} from "@tripwire/contracts";
import { Fragment, type ReactNode, useState } from "react";
import { Button } from "#/design-system/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "#/design-system/ui/popover";
import { SupportingText } from "#/design-system/ui/typography";
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
				open={editing === param.key}
				onOpenChange={(open) =>
					setEditing((current) =>
						open ? param.key : current === param.key ? null : current,
					)
				}
			>
				<PopoverTrigger
					aria-label={`Edit ${param.label}, now ${spokenValue(param, cfg[param.key])}`}
					className="cursor-pointer rounded-tag underline decoration-line-strong decoration-dotted underline-offset-3 transition-colors duration-(--dur-state) ease-out focus-sm hover:decoration-solid data-popup-open:decoration-solid"
				>
					<ParamValue param={param} value={cfg[param.key]} />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					initialFocus={param.kind === "string-list" ? false : undefined}
				>
					<PopoverTitle>{param.label}</PopoverTitle>
					<ParamEditor
						onCancel={() => setEditing(null)}
						onSave={(value) => onSaveParam(param.key, value)}
						param={param}
						value={cfg[param.key]}
					/>
					{settingsScope && (
						<Button
							className="self-start"
							nativeButton={false}
							render={
								<Link
									params={{ ...settingsScope, ruleId }}
									to="/$org/$repo/rules/$ruleId/settings"
								/>
							}
							size="sm"
							variant="secondary"
						>
							Open settings
						</Button>
					)}
				</PopoverContent>
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
