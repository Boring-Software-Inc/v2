import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { SIDEBAR_COLLAPSED_COOKIE } from "#/lib/sidebar-preference";

export const getSidebarPreference = createServerFn({ method: "GET" }).handler(
	() => ({
		collapsed: getCookie(SIDEBAR_COLLAPSED_COOKIE) === "1",
	}),
);
