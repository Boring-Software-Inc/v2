import { z } from "zod";

/**
 * Organizations (§org-model). One org concept with a flag: every user gets a
 * personal org at signup (single member, undeletable, no invites); team orgs
 * are user-creatable with full features. Exactly two roles — member reads,
 * admin additionally mutates. This file is the wire language only; enforcement
 * lives server-side (deny-by-default middlewares + organizationHooks).
 */

export const orgRoleSchema = z.enum(["admin", "member"]);
export type OrgRole = z.infer<typeof orgRoleSchema>;

/**
 * Every current and plausible top-level route. A slug colliding with one of
 * these would shadow a real page under /:org routing — reserve them all.
 * Append-only; removing an entry can orphan an org URL.
 */
export const RESERVED_ORG_SLUGS = new Set([
	// current top-level routes
	"activity",
	"analytics",
	"api",
	"dev",
	"dither-kit",
	"invite",
	"login",
	"moderation",
	"oauth",
	"onboarding",
	"queue",
	"rules",
	"runs",
	"workflows",
	// plausible top-level routes
	"admin",
	"app",
	"auth",
	"blog",
	"brand",
	"changelog",
	"dashboard",
	"docs",
	"help",
	"home",
	"legal",
	"new",
	"pricing",
	"privacy",
	"settings",
	"signup",
	"status",
	"support",
	"terms",
	"www",
	// brand terms
	"tripwire",
	"boring",
	"boringsoftware",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * The ONE slug validator, shared client+server (contracts imports nothing but
 * zod, so both sides can hold the same line). Lowercase alphanumeric+hyphens,
 * 3–32 chars, no leading/trailing hyphen, not a reserved route.
 */
export const orgSlugSchema = z
	.string()
	.min(3, "slug must be at least 3 characters")
	.max(32, "slug must be at most 32 characters")
	.regex(
		SLUG_PATTERN,
		"lowercase letters, numbers, and hyphens only — no leading or trailing hyphen",
	)
	.refine((slug) => !RESERVED_ORG_SLUGS.has(slug), {
		message: "this name is reserved",
	});

/**
 * Slugify a display name (or GitHub login) into candidate form. NOT validation
 * — run the result through `orgSlugSchema`; on collision the caller appends a
 * numeric suffix (see `suffixSlug`).
 */
export function slugifyOrgName(name: string): string {
	const base = name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "") // strip diacritics
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 32)
		.replace(/-+$/g, "");
	// Pad too-short results so the validator's 3-char floor can pass.
	return base.length >= 3 ? base : base.padEnd(3, "0");
}

/** Collision suffixing: `acme` → `acme-2`, keeping within the 32-char cap. */
export function suffixSlug(slug: string, n: number): string {
	const suffix = `-${n}`;
	return slug.slice(0, 32 - suffix.length).replace(/-+$/g, "") + suffix;
}

/** GitHub's two installable account types, carried on installation events. */
export const forgeAccountTypeSchema = z.enum(["User", "Organization"]);
export type ForgeAccountType = z.infer<typeof forgeAccountTypeSchema>;

/** Invite link creation payload (admin-only server surface). */
export const createInviteInputSchema = z.object({
	role: orgRoleSchema,
	/** 1 = single-use. */
	maxUses: z.number().int().min(1).max(1000).default(1),
	/** Days until expiry; default 7 per spec. */
	expiresInDays: z.number().int().min(1).max(90).default(7),
});
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;
