# GitCafe staging app proposal

Review only. No app, OAuth client, endpoint, key, secret, or listing has been registered or enabled. This is a minimal read-and-delivery pilot, not the permissions needed for Tripwire enforcement. Confirm the publisher organization, public links, ingress, and GitCafe admission before using it.

The following candidate create body requests PR read access and two PR events. Lifecycle events are delivered independently of the event list. The URL is a proposed staging ingress, not a verified route; `/webhooks/gitcafe` currently refuses GitCafe. Replace the links only after verifying ownership and the privacy/support pages. GitCafe must admit the publisher's pilot or approve a listing before other organizations can install it.

```json
{
  "slug": "tripwire-staging",
  "manifest": {
    "schema_version": 1,
    "name": "Tripwire staging",
    "summary": "Staging integration for contribution review.",
    "links": {
      "homepage": "https://tripwire.sh",
      "support": "https://tripwire.sh",
      "privacy": "https://tripwire.sh"
    },
    "capabilities": {
      "bot": { "display_name": "Tripwire staging" },
      "webhooks": {
        "url": "https://staging.tripwire.sh/webhooks/gitcafe",
        "events": ["pull.created", "pull.synchronized"]
      },
      "oauth": {
        "redirect_uris": ["https://staging.tripwire.sh/api/auth/callback/gitcafe"]
      }
    },
    "permissions": {
      "autonomous": {
        "scopes": [{ "kind": "pr", "family": "contents", "level": "read" }]
      }
    }
  }
}
```

The candidate does not request user repository access or write permissions. Verify that GitCafe accepts the event/permission pairing; expand permissions only for an individually reviewed action and authorized test. Setup URL and public listing are deliberately omitted until their endpoints and copy are reviewed. If production OAuth is later authorized, its candidate callback is `https://app.tripwire.sh/api/auth/callback/gitcafe`; register exact staging and production URLs separately as appropriate. Neither is certified by a real exchange.

Installed Better Auth 1.7.12 generic OAuth uses core `/callback/:id`, with default base path `/api/auth`; `createAuth` passes `baseUrl` and does not override the base path. The installed generic provider supports an optional client secret, `tokenEndpointAuth`, and PKCE, and its verified ID-token path uses discovery JWKS, issuer, client ID audience and nonce. This inspection does not prove end-to-end compatibility, state verification, verified-email mapping, or account binding. The old `.env.example` OpenGit callback is not evidence for GitCafe. Use public-client authentication without a secret, S256, issuer `https://git.cafe`, stable `sub` as identity, mutable handle as profile data, verified email and explicit state/nonce/audience checks. Keep login inactive until a registered-client flow proves these properties.

After parent review and separate authorization:

1. Confirm pilot/listing eligibility and exact publisher, support/privacy links, staging ingress and callback routing. Register the minimal staging app and its OAuth client only after these are settled.
2. Generate a P-256 key privately; register its public half and unique key ID. Provision the private key and one-time webhook secret through an approved secret channel; do not paste them into chat, logs or fixtures. Record the webhook key version and rotation process.
3. Install on a sacrificial organization with selected repositories. Verify the installer's administrator authority and state binding, then capture installation lookup, token response and signed lifecycle deliveries through the sanctioned capture workflow. Test pause, resume, repository selection, revocation, uninstall and rotation before considering activation.
4. Exercise a real public-client S256 login, denial, bad issuer/audience/nonce/state, unverified email, reconnect and handle rename. Test team and organization reviewer actor IDs with request, readback and notification. Separately test initial historical GitHub import and ongoing synchronization, since the guide and founder statement differ.
5. Keep account age and global reputation unavailable without provider evidence; do not substitute zero or local counts. Submitted review body editing remains unverified as a separate operation. Record actual evidence and request a separate review before enabling ingest, actions or login.

Sources: [app guide](https://git.cafe/docs/integrations/apps.md), [webhook guide](https://git.cafe/docs/integrations/webhooks.md), [sign-in guide](https://git.cafe/docs/integrations/sign-in-with-gitcafe.md), [OpenAPI](https://git.cafe/api/openapi/json).
