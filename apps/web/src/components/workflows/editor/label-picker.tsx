import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useContext, useState } from "react";
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
import { ReviewerScopeContext } from "#/components/workflows/editor/reviewer-picker";
import { labelColor, labelOptions } from "#/lib/label-options";
import { refreshRepoLabels } from "#/lib/labels.functions";
import { repoLabelsQueryOptions } from "#/lib/labels.query";

const POLL_MS = 2_000;
const WAIT_MS = 30_000;

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
	const queryClient = useQueryClient();
	const anchor = useComboboxAnchor();
	const [waiting, setWaiting] = useState<{
		since: string | null;
		until: number;
	} | null>(null);
	const waitingFor = (syncedAt: string | null | undefined) =>
		waiting !== null &&
		(syncedAt ?? null) === waiting.since &&
		Date.now() < waiting.until;
	const { data, dataUpdatedAt } = useQuery({
		...repoLabelsQueryOptions(org, repoId),
		refetchInterval: (query) =>
			waitingFor(query.state.data?.syncedAt) ? POLL_MS : false,
	});
	const refresh = useMutation({
		mutationFn: refreshRepoLabels,
		onSuccess: (result) => {
			if (result.queued) {
				setWaiting({
					since: data?.syncedAt ?? null,
					until: Date.now() + WAIT_MS,
				});
			}
		},
		onSettled: () =>
			queryClient.invalidateQueries({
				queryKey: repoLabelsQueryOptions(org, repoId).queryKey,
			}),
	});
	const syncing =
		refresh.isPending || (dataUpdatedAt > 0 && waitingFor(data?.syncedAt));
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
						{synced.length > 0 ? "No labels match" : "No labels synced yet"}
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
			{synced.length === 0 ? (
				<Button
					className="self-start"
					disabled={readOnly || repoId === ""}
					onClick={() => refresh.mutate({ data: { org, repoId } })}
					pending={syncing}
					pendingLabel="Refreshing"
					size="sm"
					variant="ghost"
				>
					<Icon icon={Retry} />
					Refresh labels
				</Button>
			) : null}
		</div>
	);
}
