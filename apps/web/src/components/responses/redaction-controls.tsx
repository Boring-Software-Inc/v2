import type { RedactionPolicy, RedactionSurface } from "@tripwire/contracts";
import { REDACTION_SURFACES } from "@tripwire/contracts";
import { Collapsible } from "@tripwire/ui/collapsible";
import { StepSlider } from "@tripwire/ui/slider";
import { useId } from "react";
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
		<div className="flex flex-col composition-gap-section">
			<div
				className="flex flex-col composition-gap-section composition-inline-inset"
				data-layout-role="response-redaction-level"
			>
				<div className="flex items-baseline justify-between gap-6">
					<span
						className={
							disabled ? "content-label tone-content-disabled" : "content-label"
						}
						id={labelId}
					>
						Level
					</span>
					<span
						aria-live="polite"
						className={
							disabled
								? "type-heading-sm tone-content-disabled"
								: "type-heading-sm tone-content-primary"
						}
					>
						{stopName(policy.level)}
					</span>
				</div>
				<StepSlider
					ariaLabelledBy={labelId}
					disabled={disabled}
					getValueText={stopName}
					onValueChange={onLevel}
					showTickLabels={false}
					steps={REDACTION_STEPS.map((step) => ({
						label: REDACTION_MAJOR_STEPS.includes(step) ? stopName(step) : "",
						value: step,
					}))}
					value={policy.level}
				/>
			</div>
			<RedactionTally disabled={disabled} level={policy.level} />
			<Collapsible
				closedSummary={[policy.surfaces.length, REDACTION_SURFACES.length].join(
					" of ",
				)}
				trigger="Where it applies"
				variant="compact"
			>
				<div className="flex flex-col composition-gap-hairline">
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
