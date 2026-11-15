import type { TooltipProps } from "./tooltip";

const trigger = <button type="button">Search</button>;
function acceptsTooltip(_props: TooltipProps): void {}

acceptsTooltip({ trigger, children: "Search commands" });

// @ts-expect-error Tooltip cannot be controlled and seeded at the same time.
acceptsTooltip({
	trigger,
	children: "Search commands",
	open: true,
	defaultOpen: true,
});

// @ts-expect-error Rich or actionable content belongs in a Popover.
acceptsTooltip({ trigger, children: <a href="/commands">Search commands</a> });
