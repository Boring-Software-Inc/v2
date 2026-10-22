import type { RedactionPolicy, ResponseConfig } from "@tripwire/contracts";
import { RedactionControls } from "#/components/responses/redaction-controls";
import { encodeSurfaces } from "#/components/responses/redaction-model";
import {
	SettingSection,
	SettingToggle,
} from "#/components/responses/setting-rows";
import type { useSaveQueue } from "#/components/save-queue";

export interface RedactionSettingsProps {
	config: ResponseConfig;
	orgPolicy: RedactionPolicy;
	effective: RedactionPolicy;
	canEdit: boolean;
	setField: ReturnType<typeof useSaveQueue>["setField"];
}

export function RedactionSettings({
	config,
	orgPolicy,
	effective,
	canEdit,
	setField,
}: RedactionSettingsProps) {
	const inherit = config.redaction.inherit;

	const setInherit = (on: boolean) => {
		setField("redaction.inherit", on);
		if (!on) {
			setField("redaction.level", orgPolicy.level);
			setField("redaction.surfaces", encodeSurfaces(orgPolicy.surfaces));
			setField("redaction.showHelp", orgPolicy.showHelp);
		}
	};

	return (
		<SettingSection
			description="What people outside your org see."
			id="redaction"
			title="Redaction"
		>
			<SettingToggle
				checked={inherit}
				disabled={!canEdit}
				label="Use org defaults"
				onChange={setInherit}
				setting="redaction"
			/>
			<RedactionControls
				disabled={!canEdit || inherit}
				onLevel={(level) => setField("redaction.level", level)}
				onShowHelp={(on) => setField("redaction.showHelp", on)}
				onSurfaces={(surfaces) =>
					setField("redaction.surfaces", encodeSurfaces(surfaces))
				}
				policy={effective}
			/>
		</SettingSection>
	);
}
