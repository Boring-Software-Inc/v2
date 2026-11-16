import { useQuery } from "@tanstack/react-query";
import { Accordion, Collapsible } from "@tripwire/ui/collapsible";
import { availableForgeLabels } from "@tripwire/utils/forge-sign-in";
import { providerAvailabilityQueryOptions } from "#/lib/auth.query";
import { LIVE_FORGES } from "#/lib/forge-copy";

const FAQ = [
	{
		id: "what-is-a-forge",
		question: "What is a forge?",
		answer:
			"The service that hosts your code, such as GitHub or GitLab. Tripwire checks change requests on the forge you connect.",
	},
	{
		id: "why-multiple",
		question: "Does it matter which one I pick?",
		answer:
			"Pick the forge that hosts your code. Tripwire runs the same checks on every forge. Your account tells Tripwire which repos to watch.",
	},
	{
		id: "which-supported",
		question: "Which forges are supported?",
	},
];

/**
 * The "not sure which to pick?" disclosure under the forge grid. Two levels:
 * the section itself opens, then one question at a time inside it — an
 * accordion, so the card never grows past a phone screen.
 */
export function LoginFaq() {
	const providers = useQuery(providerAvailabilityQueryOptions());
	const forges = availableForgeLabels(providers.data);
	const signInCopy =
		providers.isError || providers.isPending
			? "Sign-in providers are unavailable right now. Refresh the page to try again."
			: forges
				? `You can sign in with ${forges}; the others are not available for sign-in yet.`
				: "No sign-in providers are configured on this Tripwire server.";
	return (
		<Collapsible trigger="Not sure which to pick?" variant="compact">
			<div className="login-faq-group">
				<Accordion
					items={FAQ.map((item) => ({
						content: (
							<p data-layout-role="login-faq-answer">
								{item.id === "which-supported"
									? `Tripwire watches ${LIVE_FORGES} today. ${signInCopy}`
									: item.answer}
							</p>
						),
						label: item.question,
						value: item.id,
					}))}
				/>
			</div>
		</Collapsible>
	);
}
