import type { RedactionPolicy, RedactionSurface } from "@tripwire/contracts";
import { REDACTION_SURFACES } from "@tripwire/contracts";
import { useId } from "react";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { StepSlider } from "#/components/glaze/ui/step-slider";
import {
	REDACTION_MAJOR_STEPS,
	REDACTION_STEPS,
	REDACTION_SURFACE_LABELS,
	stopName,
	toggleSurface,
} from "#/components/responses/redaction-model";
import { RedactionTally } from "#/components/responses/redaction-tally";
import { SettingToggle } from "#/components/responses/setting-rows";

export interface RedactionControlsProps {
	policy: RedactionPolicy;
	disabled: boolean;
	onLevel: (level: number) => void;
	onSurfaces: (surfaces: RedactionSurface[]) => void;
	onShowHelp: (showHelp: boolean) => void;
}

export function RedactionControls({
	policy,
	disabled,
	onLevel,
	onSurfaces,
	onShowHelp,
}: RedactionControlsProps) {
	const labelId = useId();
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-3 px-3 py-2">
				<div className="flex items-baseline justify-between gap-6">
					<span
						className={
							disabled ? "type-label text-text-disabled" : "type-label"
						}
						id={labelId}
					>
						Level
					</span>
					<span
						aria-live="polite"
						className={
							disabled
								? "type-heading-sm text-text-disabled"
								: "type-heading-sm text-text-1"
						}
					>
						{stopName(policy.level)}
					</span>
				</div>
				<StepSlider
					aria-labelledby={labelId}
					disabled={disabled}
					getValueText={stopName}
					majorSteps={REDACTION_MAJOR_STEPS}
					onValueChange={onLevel}
					steps={REDACTION_STEPS}
					value={policy.level}
				/>
			</div>
			<RedactionTally disabled={disabled} level={policy.level} />
			<Collapsible>
				<CollapsibleTrigger
					size="sm"
					summary={`${policy.surfaces.length} of ${REDACTION_SURFACES.length}`}
				>
					Where it applies
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="flex flex-col gap-0.5">
						{REDACTION_SURFACES.map((surface) => (
							<SettingToggle
								checked={policy.surfaces.includes(surface)}
								disabled={disabled}
								key={surface}
								label={REDACTION_SURFACE_LABELS[surface]}
								onChange={(on) =>
									onSurfaces(toggleSurface(policy.surfaces, surface, on))
								}
								setting={`surface-${surface}`}
							/>
						))}
					</div>
				</CollapsibleContent>
			</Collapsible>
			<SettingToggle
				checked={policy.showHelp}
				description="How do I fix this?"
				disabled={disabled}
				label="Show how to fix it"
				onChange={onShowHelp}
				setting="help-sections"
			/>
		</div>
	);
}
