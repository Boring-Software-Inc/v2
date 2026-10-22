import { REDACTION_ITEMS } from "@tripwire/contracts";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	type Variants,
} from "motion/react";
import { Hide, Icon } from "#/components/glaze/icon";
import { PREVIEW_TRANSITION } from "#/components/responses/preview-motion";
import { REDACTION_ITEM_LABELS } from "#/components/responses/redaction-model";
import { usePreviousValue } from "#/hooks/use-previous-value";

const STAGGER_S = 0.04;

const ROW_HIDDEN = { height: 0, opacity: 0, filter: "blur(4px)" };
const ROW_SHOWN = { height: "auto", opacity: 1, filter: "blur(0px)" };

interface Step {
	level: number;
	from: number;
}

function staggerFor(position: number, { level, from }: Step): number {
	if (level > from && position > from && position <= level) {
		return (position - from - 1) * STAGGER_S;
	}
	if (level < from && position > level && position <= from) {
		return (from - position) * STAGGER_S;
	}
	return 0;
}

function rowVariants(position: number): Variants {
	return {
		hidden: (step: Step) => ({
			...ROW_HIDDEN,
			transition: { ...PREVIEW_TRANSITION, delay: staggerFor(position, step) },
		}),
		shown: (step: Step) => ({
			...ROW_SHOWN,
			transition: { ...PREVIEW_TRANSITION, delay: staggerFor(position, step) },
		}),
	};
}

const ROW_VARIANTS = REDACTION_ITEMS.map((_, index) => rowVariants(index + 1));

export function RedactionTally({
	level,
	disabled,
}: {
	level: number;
	disabled: boolean;
}) {
	const step: Step = { level, from: usePreviousValue(level) };
	const shown = REDACTION_ITEMS.slice(0, level);
	return (
		<MotionConfig reducedMotion="user">
			<ul
				aria-label="Hidden from people outside the org"
				className="flex flex-col"
			>
				<AnimatePresence custom={step} initial={false}>
					{shown.map((item, index) => (
						<motion.li
							animate="shown"
							className="overflow-hidden"
							custom={step}
							exit="hidden"
							initial="hidden"
							key={item}
							variants={ROW_VARIANTS[index]}
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
						</motion.li>
					))}
				</AnimatePresence>
			</ul>
		</MotionConfig>
	);
}
