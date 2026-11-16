import { Organization } from "./icon";
import { Select } from "./select";

const options = [
	{ label: "First", value: "first" },
	{ label: "Second", value: "second" },
] as const;

<Select ariaLabel="Choice" options={options} />;
<Select
	ariaLabelledBy="choice-label"
	form="external-form"
	name="choice"
	options={options}
	readOnly
	value="first"
/>;
<Select
	ariaLabel="Workspace"
	defaultValue="first"
	options={[
		{
			description: "Personal workspace",
			icon: Organization,
			label: "First",
			metadata: "Personal",
			value: "first",
		},
	]}
	size="large"
/>;
<Select ariaLabel="Native choice" mode="native" options={options} />;

<Select
	ariaLabel="Choice"
	// @ts-expect-error Empty strings are reserved for the nullable native sentinel.
	options={[{ label: "Empty", value: "" }]}
/>;

// @ts-expect-error A select must have exactly one accessible name.
<Select options={options} />;

// @ts-expect-error Direct and referenced names cannot be mixed.
<Select ariaLabel="Choice" ariaLabelledBy="choice-label" options={options} />;

<Select
	ariaLabel="Choice"
	defaultValue="first"
	options={options}
	// @ts-expect-error Controlled and default values cannot be mixed.
	value="second"
/>;

// @ts-expect-error Native selects cannot express read-only semantics.
<Select ariaLabel="Choice" mode="native" options={options} readOnly />;

<Select
	ariaLabel="Choice"
	// @ts-expect-error Select values are stable string identifiers.
	options={[{ label: "Object", value: { id: "object" } }]}
/>;

<Select
	ariaLabel="Choice"
	// @ts-expect-error Option icons are semantic glyphs, not arbitrary nodes.
	options={[{ icon: <span />, label: "First", value: "first" }]}
/>;

<Select
	ariaLabel="Choice"
	// @ts-expect-error Option metadata is finite text, not arbitrary layout.
	options={[{ label: "First", metadata: <span />, value: "first" }]}
/>;

// @ts-expect-error Styling escape hatches are not part of the semantic contract.
<Select ariaLabel="Choice" className="custom" options={options} />;
