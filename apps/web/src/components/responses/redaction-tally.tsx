import { REDACTION_ITEMS } from "@tripwire/contracts";
import type { CSSProperties } from "react";
import { Hide, Icon } from "#/components/glaze/icon";
import { REDACTION_ITEM_LABELS } from "#/components/responses/redaction-model";
import { usePreviousValue } from "#/hooks/use-previous-value";

const STAGGER_MS = 40;

function staggerFor(position: number, level: number, from: number): number {
	if (level > from && position > from && position <= level) {
		return (position - from - 1) * STAGGER_MS;
	}
	if (level < from && position > level && position <= from) {
		return (from - position) * STAGGER_MS;
	}
	return 0;
}

export function RedactionTally({
	level,
	disabled,
}: {
	level: number;
	disabled: boolean;
}) {
	const from = usePreviousValue(level);
	return (
		<ul
			aria-label="Hidden from people outside the org"
			className="flex flex-col"
		>
			{REDACTION_ITEMS.map((item, index) => {
				const position = index + 1;
				const shown = position <= level;
				return (
					<li
						aria-hidden={!shown}
						data-shown={shown || undefined}
						data-tally-row=""
						key={item}
						style={
							{
								"--tally-delay": `${staggerFor(position, level, from)}ms`,
							} as CSSProperties
						}
					>
						<div className="flex min-h-8 items-center gap-2.5 px-3">
							<Icon
								className={disabled ? "text-text-disabled" : "text-text-2"}
								icon={Hide}
							/>
							<span
								className={
									disabled
										? "type-body-sm text-text-disabled"
										: "type-body-sm text-text-1"
								}
							>
								{REDACTION_ITEM_LABELS[item]}
							</span>
						</div>
					</li>
				);
			})}
		</ul>
	);
}
