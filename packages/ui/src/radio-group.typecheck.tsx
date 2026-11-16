import { ChartLine } from "./icon";
import { RadioGroup, SegmentedControl } from "./radio-group";

const options = [
	{ label: "First", value: "first" },
	{ label: "Second", value: "second" },
] as const;

<RadioGroup ariaLabel="Choice" options={options} />;
<RadioGroup ariaLabelledBy="choice-label" options={options} value="first" />;
<SegmentedControl ariaLabel="View" defaultValue="first" options={options} />;
<SegmentedControl
	ariaLabel="Chart view"
	fill
	options={[
		{ icon: ChartLine, iconOnly: true, label: "Chart", value: "chart" },
	]}
	size="small"
/>;
<SegmentedControl
	ariaLabel="Formatting"
	defaultValue={["first"]}
	multiple
	options={options}
/>;

// @ts-expect-error A group must have exactly one accessible name.
<RadioGroup options={options} />;

// @ts-expect-error Direct and referenced names cannot be mixed.
<RadioGroup
	ariaLabel="Choice"
	ariaLabelledBy="choice-label"
	options={options}
/>;

// @ts-expect-error Controlled and default values cannot be mixed.
<RadioGroup
	ariaLabel="Choice"
	defaultValue="first"
	options={options}
	value="second"
/>;

// @ts-expect-error Segmented controls do not submit a named form value.
<SegmentedControl ariaLabel="View" name="view" options={options} />;

// @ts-expect-error Multiple segmented controls use array values.
<SegmentedControl
	ariaLabel="Formatting"
	multiple
	options={options}
	value="first"
/>;

// @ts-expect-error Single segmented controls use scalar values.
<SegmentedControl ariaLabel="View" options={options} value={["first"]} />;

<SegmentedControl
	ariaLabel="View"
	options={[
		// @ts-expect-error Icon-only options require an icon.
		{ iconOnly: true, label: "Chart", value: "chart" },
	]}
/>;

// @ts-expect-error Read-only is not a multiple-selection state.
<SegmentedControl ariaLabel="Formatting" multiple options={options} readOnly />;

// @ts-expect-error Styling escape hatches are not part of the semantic contract.
<RadioGroup ariaLabel="Choice" className="custom" options={options} />;
