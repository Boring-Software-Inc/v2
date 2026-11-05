import { definePlugin } from "@oxlint/plugins";
import { noArbitraryTailwindValuesRule } from "./rules/no-arbitrary-tailwind-values.ts";
import { noDirectImplementationImportsRule } from "./rules/no-direct-implementation-imports.ts";
import { noInlineVisualStylesRule } from "./rules/no-inline-visual-styles.ts";
import { noRawColorRule } from "./rules/no-raw-color.ts";
import { noRawSpacingRule } from "./rules/no-raw-spacing.ts";
import { noRawTypographyRule } from "./rules/no-raw-typography.ts";

/** Project-specific enforcement for Tripwire's semantic application UI contract. */
const designSystemPlugin = definePlugin({
	meta: { name: "design-system" },
	rules: {
		"no-arbitrary-tailwind-values": noArbitraryTailwindValuesRule,
		"no-direct-implementation-imports": noDirectImplementationImportsRule,
		"no-inline-visual-styles": noInlineVisualStylesRule,
		"no-raw-color": noRawColorRule,
		"no-raw-spacing": noRawSpacingRule,
		"no-raw-typography": noRawTypographyRule,
	},
});

export default designSystemPlugin;
