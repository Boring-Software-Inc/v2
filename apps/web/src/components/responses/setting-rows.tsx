import { type ReactNode, useId } from "react";
import { Checkbox } from "#/components/glaze/ui/checkbox";
import { Switch } from "#/components/glaze/ui/switch";
import {
	PreviewLinked,
	type PreviewSetting,
} from "#/components/responses/preview-link";
import { cn } from "#/lib/glaze/utils";

export const SETTING_ROW = "rounded-panel px-3 py-2";
export const SETTING_NESTED = "ps-10";

export function SettingSection({
	id,
	title,
	description,
	children,
}: {
	id: string;
	title: string;
	description?: string;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			className="flex flex-col gap-2"
			data-feedback-name="SettingSection"
		>
			<header className="flex flex-col gap-0.5 px-3">
				<h2 className="type-heading-sm" id={id}>
					{title}
				</h2>
				{description ? (
					<p className="type-body-sm text-text-2">{description}</p>
				) : null}
			</header>
			<div className="flex flex-col gap-0.5">{children}</div>
		</section>
	);
}

export function SettingToggle({
	label,
	description,
	checked,
	disabled,
	setting,
	nested = false,
	onChange,
}: {
	label: string;
	description?: string;
	checked: boolean;
	disabled: boolean;
	setting: PreviewSetting;
	nested?: boolean;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<PreviewLinked setting={setting}>
			<label
				htmlFor={id}
				className={cn(
					"flex items-start gap-3",
					SETTING_ROW,
					nested && SETTING_NESTED,
					disabled ? "cursor-default" : "cursor-pointer",
				)}
			>
				<Checkbox
					aria-describedby={description ? `${id}-d` : undefined}
					aria-labelledby={`${id}-l`}
					id={id}
					checked={checked}
					disabled={disabled}
					onCheckedChange={(next) => {
						onChange(next === true);
					}}
				/>
				<span className="flex min-w-0 flex-col gap-0.5">
					<span
						className={cn(
							"type-label",
							disabled ? "text-text-disabled" : "text-text-1",
						)}
						id={`${id}-l`}
					>
						{label}
					</span>
					{description ? (
						<span
							className={cn(
								"type-body-sm",
								disabled ? "text-text-disabled" : "text-text-2",
							)}
							id={`${id}-d`}
						>
							{description}
						</span>
					) : null}
				</span>
			</label>
		</PreviewLinked>
	);
}

export function SettingSwitch({
	label,
	checked,
	disabled,
	setting,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled: boolean;
	setting: PreviewSetting;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<PreviewLinked setting={setting}>
			<div
				className={cn(
					"flex min-h-(--row) items-center justify-between gap-3",
					SETTING_ROW,
				)}
			>
				<label
					className={cn(
						"type-label",
						disabled ? "text-text-disabled" : "cursor-pointer text-text-1",
					)}
					htmlFor={id}
				>
					{label}
				</label>
				<Switch
					checked={checked}
					disabled={disabled}
					id={id}
					onCheckedChange={(next) => onChange(next)}
				/>
			</div>
		</PreviewLinked>
	);
}

export function SettingFact({
	label,
	value,
	setting,
}: {
	label: string;
	value: string;
	setting: PreviewSetting;
}) {
	return (
		<PreviewLinked setting={setting}>
			<div
				className={cn(
					"flex min-h-(--row) items-center justify-between gap-3",
					SETTING_ROW,
				)}
			>
				<span className="type-label text-text-2">{label}</span>
				<span className="type-body-sm text-text-2">{value}</span>
			</div>
		</PreviewLinked>
	);
}
