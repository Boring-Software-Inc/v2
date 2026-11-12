import { useMutation } from "@tanstack/react-query";
import { Button } from "#/design-system/ui/button";
import { SupportingText } from "#/design-system/ui/typography";
import { authClient } from "#/lib/auth-client";

export function AppealSignIn({
	organization,
	returnTo,
}: {
	organization?: boolean;
	returnTo: string;
}) {
	const signIn = useMutation({
		mutationFn: async () => {
			const result = await authClient.signIn.social({
				provider: "github",
				callbackURL: returnTo,
			});
			if (result.error) throw new Error("GitHub sign-in failed");
		},
	});
	return (
		<>
			<SupportingText>
				{organization
					? "Sign in with the GitHub account you’re appealing for."
					: "Sign in with the GitHub account that opened the issue or pull request."}
			</SupportingText>
			<Button
				className="self-start"
				onClick={() => signIn.mutate()}
				pending={signIn.isPending}
			>
				Sign in with GitHub
			</Button>
			{signIn.isError && (
				<SupportingText role="alert">
					GitHub sign-in failed. Try again.
				</SupportingText>
			)}
		</>
	);
}
