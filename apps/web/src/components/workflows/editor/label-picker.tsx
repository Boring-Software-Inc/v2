import { Button } from "@tripwire/ui/button";
import { Combobox } from "@tripwire/ui/combobox";
import { Icon, Retry } from "@tripwire/ui/icon";
import { Status } from "@tripwire/ui/status";
import { useContext } from "react";
import { ReviewerScopeContext } from "#/components/workflows/editor/reviewer-picker";
import { useSyncedList } from "#/hooks/use-synced-list";
import { labelColor, labelOptions } from "#/lib/label-options";
import { refreshRepoLabels } from "#/lib/labels.functions";
import { repoLabelsQueryOptions } from "#/lib/labels.query";

function LabelDot({ color }: { color: string | null }) {
	return (
		<span
			aria-hidden="true"
			className="inline-block size-2 shrink-0 overflow-hidden rounded-full"
		>
			<svg aria-hidden="true" focusable="false" viewBox="0 0 8 8">
				<circle cx="4" cy="4" fill={color ? `#${color}` : "none"} r="4" />
				<circle cx="4" cy="4" data-label-swatch-ring="" fill="none" r="3.5" />
			</svg>
		</span>
	);
}

export interface LabelPickerProps {
	value: readonly string[];
	onChange: (next: string[]) => void;
	readOnly: boolean;
	creatable?: boolean;
	placeholder?: string;
	id?: string;
	"aria-label"?: string;
	showRefresh?: boolean;
}

function useRepoLabels() {
	const scope = useContext(ReviewerScopeContext);
	const org = scope?.org ?? "";
	const repoId = scope?.repoId ?? "";
	const list = useSyncedList(repoLabelsQueryOptions(org, repoId), () =>
		refreshRepoLabels({ data: { org, repoId } }),
	);
	return { ...list, repoId };
}

export function RefreshLabels({ readOnly }: { readOnly: boolean }) {
	const { data, loading, syncing, refresh, repoId } = useRepoLabels();
	if (loading && (data?.labels ?? []).length === 0) {
		return (
			<Status size="small" status="running">
				Loading labels
			</Status>
		);
	}
	return (
		<div className="self-start">
			<Button
				disabled={readOnly || repoId === ""}
				onAction={refresh}
				pending={syncing}
				pendingLabel="Refreshing"
				size="small"
				variant="ghost"
			>
				<Icon icon={Retry} />
				Refresh labels
			</Button>
		</div>
	);
}

export function LabelPicker({
	value,
	onChange,
	readOnly,
	creatable = false,
	placeholder,
	"aria-label": ariaLabel,
	showRefresh = true,
}: LabelPickerProps) {
	const { data, loading } = useRepoLabels();
	const synced = data?.labels ?? [];
	const options = labelOptions(synced, value);
	const names = options.map((option) => option.name);

	return (
		<div className="flex flex-col composition-gap-standard">
			<Combobox<string>
				allowCustomValue={creatable}
				ariaLabel={ariaLabel ?? "Labels"}
				createLabel={creatable ? (query) => `Create ${query}` : undefined}
				disabled={readOnly}
				emptyLabel={
					loading && synced.length === 0
						? "Loading labels"
						: synced.length > 0
							? "No labels match"
							: "No labels found"
				}
				multiple
				onCreate={
					creatable ? (query) => onChange([...value, query]) : undefined
				}
				onValueChange={(next) => onChange(next)}
				options={names.map((name) => ({
					icon: <LabelDot color={labelColor(options, name)} />,
					label: name,
					value: name,
				}))}
				placeholder={
					placeholder ?? (creatable ? "Pick or type a label" : "Pick labels")
				}
				value={[...value]}
			/>
			{showRefresh ? <RefreshLabels readOnly={readOnly} /> : null}
		</div>
	);
}
