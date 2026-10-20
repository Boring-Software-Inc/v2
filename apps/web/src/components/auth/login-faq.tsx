import {
	Collapsible,
	CollapsibleContent,
	CollapsibleGroup,
	CollapsibleTrigger,
} from "#/components/glaze/ui/collapsible";
import { LIVE_FORGES, SIGN_IN_FORGES } from "#/lib/forge-copy";

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
			"You sign in with whichever forge hosts your code. The checks are identical everywhere. The account just tells Tripwire where to watch.",
	},
	{
		id: "which-supported",
		question: "Which forges are supported?",
		// Two different sets, and conflating them would be a lie: you can sign in
		// with a forge before tripwire can watch its repos. Both generated from
		// the catalog, so an adapter shipping can't leave this calling it "next".
		answer: `Tripwire watches ${LIVE_FORGES} today. You can sign in with ${SIGN_IN_FORGES}; the rest are coming.`,
	},
];

/**
 * The "not sure which to pick?" disclosure under the forge grid. Two levels:
 * the section itself opens, then one question at a time inside it — an
 * accordion, so the card never grows past a phone screen.
 */
export function LoginFaq() {
	return (
		<Collapsible>
			<CollapsibleTrigger size="sm">Not sure which to pick?</CollapsibleTrigger>
			<CollapsibleContent>
				<CollapsibleGroup className="pt-1" variant="plain">
					{FAQ.map((item) => (
						<Collapsible key={item.id} value={item.id}>
							<CollapsibleTrigger>{item.question}</CollapsibleTrigger>
							<CollapsibleContent>
								<p className="type-body-sm text-text-2">{item.answer}</p>
							</CollapsibleContent>
						</Collapsible>
					))}
				</CollapsibleGroup>
			</CollapsibleContent>
		</Collapsible>
	);
}
