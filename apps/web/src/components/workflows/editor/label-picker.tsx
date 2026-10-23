import { useContext } from "react";
import { Icon, Retry } from "#/components/glaze/icon";
import { Button } from "#/components/glaze/ui/button";
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
	useComboboxAnchor,
} from "#/components/glaze/ui/combobox";
import { Status } from "#/components/glaze/ui/status";
import { ReviewerScopeContext } from "#/components/workflows/editor/reviewer-picker";
import { useSyncedList } from "#/hooks/use-synced-list";
import { labelColor, labelOptions } from "#/lib/label-options";
import { refreshRepoLabels } from "#/lib/labels.functions";
import { repoLabelsQueryOptions } from "#/lib/labels.query";

function LabelDot({ color }: { color: string | null }) {
	return (
		<span
			aria-hidden
			className="inline-block size-2 shrink-0 rounded-full border border-line-faint"
			style={color ? { backgroundColor: `#${color}` } : undefined}
		/>
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
}

export function LabelPicker({
	value,
	onChange,
	readOnly,
	creatable = false,
	placeholder,
	id,
	"aria-label": ariaLabel,
}: LabelPickerProps) {
	const scope = useContext(ReviewerScopeContext);
	const org = scope?.org ?? "";
	const repoId = scope?.repoId ?? "";
	const anchor = useComboboxAnchor();
	const { data, loading, syncing, refresh } = useSyncedList(
		repoLabelsQueryOptions(org, repoId),
		() => refreshRepoLabels({ data: { org, repoId } }),
	);
	const synced = data?.labels ?? [];
	const options = labelOptions(synced, value);
	const names = options.map((option) => option.name);

	return (
		<div className="flex flex-col gap-2">
			<Combobox<string, true>
				creatable={creatable}
				disabled={readOnly}
				items={names}
				multiple
				onValueChange={(next) => onChange(next)}
				value={[...value]}
			>
				<ComboboxChips ref={anchor}>
					<ComboboxValue>
						{(selected: string[]) => (
							<>
								{selected.map((name) => (
									<ComboboxChip key={name} value={name}>
										<span className="inline-flex items-center gap-1.5">
											<LabelDot color={labelColor(options, name)} />
											{name}
										</span>
									</ComboboxChip>
								))}
								<ComboboxChipsInput
									aria-label={ariaLabel}
									id={id}
									placeholder={
										selected.length > 0
											? ""
											: (placeholder ??
												(creatable ? "Pick or type a label" : "Pick labels"))
									}
								/>
							</>
						)}
					</ComboboxValue>
				</ComboboxChips>
				<ComboboxContent anchor={anchor}>
					<ComboboxEmpty>
						{loading && synced.length === 0
							? "Loading labels"
							: synced.length > 0
								? "No labels match"
								: "No labels found"}
					</ComboboxEmpty>
					<ComboboxList>
						{(name: string) => (
							<ComboboxItem key={name} value={name}>
								<span className="flex min-w-0 items-center gap-2">
									<LabelDot color={labelColor(options, name)} />
									<span className="truncate">{name}</span>
								</span>
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
			{loading && synced.length === 0 ? (
				<Status size="sm" status="running">
					Loading labels
				</Status>
			) : (
				<Button
					className="self-start"
					disabled={readOnly || repoId === ""}
					onClick={refresh}
					pending={syncing}
					pendingLabel="Refreshing"
					size="sm"
					variant="ghost"
				>
					<Icon icon={Retry} />
					Refresh labels
				</Button>
			)}
		</div>
	);
}
