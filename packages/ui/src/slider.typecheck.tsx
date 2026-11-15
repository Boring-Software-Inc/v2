import { Slider, StepSlider } from "./slider";

export function sliderContracts() {
	void (<Slider ariaLabel="Volume" defaultValue={20} name="volume" readOnly />);
	void (
		<StepSlider
			ariaLabelledBy="policy"
			steps={[
				{ label: "Open", value: 0 },
				{ label: "Strict", value: 1 },
			]}
			value={1}
		/>
	);
	// @ts-expect-error Controlled and uncontrolled slider state are exclusive.
	void (<Slider ariaLabel="Volume" defaultValue={20} value={40} />);
	// @ts-expect-error Every slider needs an accessible name.
	void (<Slider defaultValue={20} />);
	void (
		<StepSlider
			ariaLabel="Policy"
			// @ts-expect-error StepSlider derives its numeric bounds from declared stops.
			max={10}
			steps={[
				{ label: "Open", value: 0 },
				{ label: "Strict", value: 1 },
			]}
		/>
	);
}
