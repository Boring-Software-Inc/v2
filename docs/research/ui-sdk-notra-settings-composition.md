# Notra settings composition

Notra’s settings screens use one content gutter and keep the page structure stable when data changes. Tripwire can apply those two ideas with its existing design system.

**Reference:** [Notra Settings in Paper](https://app.paper.design/file/01M76GPFFR31D7F3BBV7C7VCV9/p-2-0). The review covered the General (203-0), Members (26K-0), Pending (4JR-0) and Delete organization (268-0) frames, alongside Account and Preferences. This was a desktop artboard and source comparison. Responsive and interactive checks below describe proposed acceptance tests.

| Pattern | What the frames show | Where it belongs in Tripwire |
| --- | --- | --- |
| Shared edge | The page header, toolbar and panels sit on one left and right lane inside the inset shell. | Give [SettingsFrame](../../apps/web/src/components/settings/settings-frame.tsx) ownership of the settings gutter and section rhythm. |
| Stable section frame | General uses the same shell for details, connected accounts and deletion. Notra’s 1024px samples use a 20px inline gutter, a 24px inter-section gap and a shallow inset. | Compose the existing [Card](../../packages/ui/src/card.tsx) and [Panel](../../packages/ui/src/panel.tsx) with a heading, body and action slot. Use Tripwire tokens for dimensions and surfaces. |
| Stable table frame | Members and Pending retain the same tabs, trailing action and column-header band. The empty state sits in the table body. | Keep the existing [Members page](../../apps/web/src/components/organizations/org-members-page.tsx) toolbar and replace its framed list with one [Table](../../packages/ui/src/table.tsx). |
| Independent rows | Account groups profile, sign-in and appearance by purpose. The preview has its own group above compact controls. | Keep [Item](../../packages/ui/src/item.tsx) rows for independent Account and Roles controls. Keep selection and workspace-role badges in their existing positions. |

Start with [General](../../apps/web/src/components/organizations/org-general-settings-page.tsx). Match the geometry of editable, read-only and loading sections. Reuse the frame for deletion with danger tokens, the existing permission check and the existing confirmation. Put the consequence in the body and keep the action in the trailing slot.

Then update Members and Pending together. Use Member, Role and Actions for Members; Invite link, Usage, Expires and Actions for Pending. Keep the Add/Invite controls, filters, invite-link lifecycle and revoke confirmation. Use the Tripwire ghost in the table body when there are no rows. Add sort affordances only when there is a working sort.

At narrow widths and native 200% zoom, let the toolbar and actions wrap while preserving their reading order. Confine any horizontal scrolling to the labeled table region. Compare light and dark; keyboard through the tabs, filters, menus and confirmations; and use long emails, custom role names, loading, empty, read-only and validation states. A settings composition example in the DS docs should show a normal section, a table empty state and a destructive section using the same frame rules.
