import { FlagsProvider } from "@databuddy/sdk/react";
import { type ReactNode, useMemo, useState } from "react";
import type { CurrentUser } from "#/lib/auth.functions";

interface AccountFlagsProviderProps {
	clientId: string;
	user: CurrentUser | null | undefined;
	isPending: boolean;
	children: ReactNode;
}

export function AccountFlagsProvider({
	clientId,
	user,
	isPending,
	children,
}: AccountFlagsProviderProps) {
	const accountId = user?.id ?? null;
	const email = user?.email ?? undefined;
	const login = user?.login;
	const identity = useMemo(
		() =>
			accountId
				? { userId: accountId, email, properties: { login } }
				: undefined,
		[accountId, email, login],
	);
	const [scope, setScope] = useState<{
		accountId: string | null | undefined;
		generation: number;
	}>({ accountId: isPending ? undefined : accountId, generation: 0 });
	if (!isPending && scope.accountId !== accountId) {
		setScope({
			accountId,
			generation:
				scope.accountId === undefined ? scope.generation : scope.generation + 1,
		});
	}

	return (
		<FlagsProvider
			clientId={clientId}
			isPending={isPending}
			key={`${clientId}:${scope.generation}`}
			skipStorage
			user={identity}
		>
			{children}
		</FlagsProvider>
	);
}
