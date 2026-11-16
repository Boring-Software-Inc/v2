import { sourceOf } from "@ui-sdk/core";

export type InteractionSource =
	| "mouse"
	| "touch"
	| "pen"
	| "keyboard"
	| "virtual"
	| "programmatic"
	| "agent";

export interface InteractionDetails {
	source: InteractionSource;
}

export function interactionDetails(
	details: InteractionDetails,
): InteractionDetails {
	return { source: details.source };
}

export function interactionFromEvent(
	event?: Event,
	fallback?: InteractionSource,
): InteractionDetails {
	if (fallback === "agent") {
		return { source: "agent" };
	}
	if (!event) {
		return { source: fallback ?? "programmatic" };
	}
	const source = sourceOf(event);
	if (source !== "programmatic") {
		return { source };
	}
	if (event) {
		const constructorName = event.constructor.name;
		if (constructorName.includes("Keyboard")) {
			return { source: "keyboard" };
		}
		if (constructorName.includes("Touch")) {
			return { source: "touch" };
		}
		if (constructorName.includes("Pointer")) {
			const pointerType =
				"pointerType" in event ? String(event.pointerType) : "mouse";
			if (pointerType === "pen" || pointerType === "touch") {
				return { source: pointerType };
			}
			return { source: "mouse" };
		}
	}
	return {
		source: fallback ?? source,
	};
}

/**
 * Agent actions are confirmed by the bridge before the DOM action is issued.
 * Human and programmatic actions are confirmed by the primitive itself.
 */
export function shouldConfirmLocally(source: InteractionSource): boolean {
	return source !== "agent";
}
