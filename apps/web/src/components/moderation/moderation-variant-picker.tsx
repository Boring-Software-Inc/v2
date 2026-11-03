import { getRouteApi } from "@tanstack/react-router";

export const MODERATION_VARIANTS = ["focus", "split", "scan"] as const;
export type ModerationVariant = (typeof MODERATION_VARIANTS)[number];

const routeApi = getRouteApi("/$org/$repo/moderation");

const VARIANT_LABELS = {
	focus: "Focus — relaxed single column",
	split: "Split — queue with analytics rail",
	scan: "Scan — dense wide workspace",
} satisfies Record<ModerationVariant, string>;

export function ModerationVariantPicker() {
	const navigate = routeApi.useNavigate();
	const search = routeApi.useSearch();
	const variant = search.__variant ?? "focus";

	return (
		<fieldset data-development-variant-picker="">
			<legend>Development preview · operational density</legend>
			<label>
				Composition
				<select
					onChange={(event) => {
						const next = event.currentTarget.value as ModerationVariant;
						void navigate({
							search: (previous) => ({ ...previous, __variant: next }),
						});
					}}
					value={variant}
				>
					{MODERATION_VARIANTS.map((candidate) => (
						<option key={candidate} value={candidate}>
							{VARIANT_LABELS[candidate]}
						</option>
					))}
				</select>
			</label>
		</fieldset>
	);
}
