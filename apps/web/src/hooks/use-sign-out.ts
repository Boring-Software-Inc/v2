import {
	mutationOptions,
	type QueryClient,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "#/components/glaze/ui/toast";
import { authClient } from "#/lib/auth-client";

interface SignOutEffects {
	signOut: () => Promise<{ error: unknown }>;
	go: (url: string) => void;
	fail: (message: string) => void;
}

const SIGN_OUT_FAILED = "Tripwire could not sign you out. Try again.";

const BROWSER_EFFECTS: SignOutEffects = {
	signOut: () => authClient.signOut(),
	go: (url) => window.location.assign(url),
	fail: (message) => toast.fail(message),
};

export function signOutMutationOptions(
	queryClient: QueryClient,
	effects: SignOutEffects = BROWSER_EFFECTS,
) {
	return mutationOptions({
		mutationFn: async () => {
			const { error } = await effects.signOut();
			if (error) {
				throw new Error(SIGN_OUT_FAILED);
			}
		},
		networkMode: "always",
		retry: false,
		onSuccess: () => {
			queryClient.clear();
			effects.go("/login");
		},
		onError: () => effects.fail(SIGN_OUT_FAILED),
	});
}

export function useSignOut() {
	return useMutation(signOutMutationOptions(useQueryClient()));
}
