/**
 * @tripwire/forge-opengit — the open-git adapter, INGEST ONLY.
 *
 * open-git's API has no read endpoints (no diff, no commits, no contents, no
 * users), so this package deliberately does not implement `ForgeAdapter`: four
 * of its seven methods have nothing to call. What exists here is the inbound
 * half — signature verification and normalization — which is real, testable,
 * and enough to store a verified audit trail of deliveries.
 *
 * It never imports a sibling adapter (§3), including for the signature scheme
 * it happens to share with GitHub.
 */
export { normalizeWebhook } from "./webhook/normalize.ts";
export { signWebhookBody, verifyWebhookSignature } from "./webhook/verify.ts";
