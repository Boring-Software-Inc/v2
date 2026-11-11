import type { CurrentUser } from "#/lib/auth.functions";

export const PLACEHOLDER_USER: CurrentUser = {
	id: "",
	name: "local session",
	login: "dev",
	forgeLogin: null,
	email: null,
	image: "",
};

export function accountIdentity(user: CurrentUser): string | null {
	if (user.email) {
		return user.email;
	}
	if (user.login && user.login !== user.name) {
		return `@${user.login}`;
	}
	return null;
}
