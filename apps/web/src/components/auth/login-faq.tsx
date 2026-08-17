import { useState } from "react";
import { LIVE_FORGES, SIGN_IN_FORGES } from "#/lib/forge-copy";

/** 12×12 chevron and plus/minus from the artboard — hairline strokes on the
 * icon token, sized to sit in the 16px meta lane without a wrapper. */
function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={`size-3 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? "" : "rotate-180"}`}
			fill="none"
			viewBox="0 0 12 12"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M3 7.5 L6 4.5 L9 7.5"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.5"
			/>
		</svg>
	);
}

function PlusMinus({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className="size-3 shrink-0 text-muted-foreground"
			viewBox="0 0 12 12"
			xmlns="http://www.w3.org/2000/svg"
		>
			<line
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.5"
				x1="2"
				x2="10"
				y1="6"
				y2="6"
			/>
			{/* The upright stroke is what turns minus into plus — collapse it rather
			    than swapping icons so the crossbar stays put through the toggle. */}
			<line
				className={`origin-center transition-transform duration-200 ${open ? "scale-y-0" : ""}`}
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.5"
				x1="6"
				x2="6"
				y1="2"
				y2="10"
			/>
		</svg>
	);
}

const FAQ = [
	{
		id: "what-is-a-forge",
		question: "What is a forge?",
		answer:
			"The host your code lives on: GitHub, GitLab, or anything self-hosted. Tripwire sits in front of whichever you use.",
	},
	{
		id: "why-multiple",
		question: "Why are there multiple options?",
		answer:
			"You sign in with whichever forge hosts your code. The checks are identical everywhere — the account just tells Tripwire where to watch.",
	},
	{
		id: "which-supported",
		question: "Which forges are supported?",
		// Two different sets, and conflating them would be a lie: you can sign in
		// with a forge before tripwire can watch its repos. Both generated from
		// the catalog, so an adapter shipping can't leave this calling it "next".
		answer: `tripwire watches ${LIVE_FORGES} today. you can sign in with ${SIGN_IN_FORGES}; the rest are coming.`,
	},
];

/**
 * The "not sure which to pick?" disclosure under the forge grid. Two levels:
 * the section itself opens, then one question at a time inside it — an
 * accordion, so the card never grows past a phone screen.
 */
export function LoginFaq() {
	const [open, setOpen] = useState(false);
	const [expanded, setExpanded] = useState<string | null>(null);
	return (
		<>
			<button
				aria-expanded={open}
				className="relative flex w-full items-center justify-between gap-2 rounded-sm px-3 py-[9px] text-left outline-none transition-colors hover:bg-surface-1 focus-visible:ring-[3px] focus-visible:ring-ring/50"
				onClick={() => setOpen((prev) => !prev)}
				type="button"
			>
				<span className="font-medium text-[12px] text-muted-foreground leading-4">
					Not sure which to pick?
				</span>
				<Chevron open={open} />
			</button>

			{open ? (
				<div className="relative flex flex-col gap-0.5">
					{FAQ.map((item) => {
						const isExpanded = expanded === item.id;
						return (
							<div
								className="flex flex-col gap-[7px] rounded-md bg-surface-1 px-3 py-[11px]"
								key={item.id}
							>
								<button
									aria-expanded={isExpanded}
									className="flex w-full items-center justify-between gap-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
									onClick={() =>
										setExpanded((prev) => (prev === item.id ? null : item.id))
									}
									type="button"
								>
									<span
										className={`font-medium text-[12px] leading-4 transition-colors ${isExpanded ? "text-foreground" : "text-foreground/70"}`}
									>
										{item.question}
									</span>
									<PlusMinus open={isExpanded} />
								</button>
								{/* Capped short of the full 304px body so the answer never runs
								    under the icon lane above it. */}
								{isExpanded ? (
									<p className="max-w-[268px] text-[12px] text-muted-foreground leading-[17px]">
										{item.answer}
									</p>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
		</>
	);
}
