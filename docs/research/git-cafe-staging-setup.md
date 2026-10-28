# GitCafe staging setup

## Verified staging state

As of 2026-10-27, the publisher registered `tripwire-staging` and installed it in `boring` with only `scratch` selected. Production has a separate app and credentials.

| Setting | Staging value |
| --- | --- |
| App ID | `int_01m60999c0fqg841d48s29qwtv` |
| OAuth client | `app_68092ad6b9e8e34be7af65c2e42b6d6d` |
| Installation | `ins_01m609r46ff7j8gtjk7jt444kb` |
| Signing key ID | `staging-2026-10-27-1` |
| Webhook | `https://staging.api.tripwire.sh/webhooks/gitcafe` |
| Setup | `https://staging.tripwire.sh/onboarding/setup?forge=gitcafe` |
| OAuth callback | `https://staging.tripwire.sh/api/auth/callback/gitcafe` |

The registered app revision 2 has the setup URL above. The API health endpoint returned 200, but the undeployed GitCafe webhook receiver returned 404. An authorized delivery-payload read captured `installation.created`; this is provider-held payload evidence, not a locally received and HMAC-verified request.

Real app assertion requests succeeded: installation lookup returned 200 and token mint returned 201. The installed client reused a token after a fresh authority lookup. Bot-token repository metadata and organization membership reads returned 200; organization profile lookup returned 403 despite the declared metadata permission. Installation repository strings are names; repository metadata and the lifecycle payload establish stable repository IDs.

The opt-in OIDC implementation uses `GITCAFE_SIGN_IN_ENABLED=true` and `GITCAFE_CLIENT_ID`. Its callback, replay, identity, and account-link behavior have local protocol tests; a real staging OAuth exchange remains unverified. Keep login, ingest, and actions gated until their separate acceptance checks pass. No private keys, webhook secrets, or bearer tokens belong in this document.

Next: verify the real person userinfo/principal binding, fresh organization-admin authority, and explicit Tripwire organization confirmation before claims. Then verify raw signed receipt handling and lifecycle revocation before enabling evaluation. Team/organization reviewer actors, ongoing GitHub synchronization, and submitted-review editing still need direct evidence. Account age and global reputation remain unavailable.

## Historical minimal pilot proposal

The proposal below predates registration and does not describe the current manifest or permissions. Its webhook host and production callback example are not the configured endpoints. Retain it as the original review record; use the verified settings above for staging.

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
