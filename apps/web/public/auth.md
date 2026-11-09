# Set up Tripwire on staging

Use this guide in a repository checkout. Use only the test repository named by the developer. Use the staging MCP connection named `tripwire-staging`, or run the CLI as `npx --yes @tripwire-sh/cli@staging`. In the commands below, `tripwire` stands for that staging CLI invocation. Browser approval must open on `staging.tripwire.sh`.

## Identify the repository

Use the Git remote to identify the GitHub owner and repository. Confirm the intended repository with the developer if the checkout has multiple plausible remotes. Match the exact owner and repository against Tripwire before changing anything. Pass the confirmed Tripwire org to each repo command. Use the GitHub repository URL or the exact Tripwire repository URL returned by the tool.

## Connect to Tripwire

Use an existing staging MCP connection if the current agent session can call it. Call `whoami` to check the account and available organizations. If the client can authorize and reconnect within this session, pass its browser link to the developer and wait. Call `whoami` again after approval.

If MCP is unavailable in this session, run `npx --yes @tripwire-sh/cli@staging whoami`. Reuse an approved session with access to the intended organization. If the CLI asks you to sign in, run `npx --yes @tripwire-sh/cli@staging login --no-browser` and keep the process running. Give the developer the verification link and code from the output. Wait for the command to finish after browser approval, then run `npx --yes @tripwire-sh/cli@staging whoami` and continue in the same session. If the request expires or the developer denies it, stop and ask whether to try again. Use the account and organization only after `whoami` confirms approved access and agent access for that organization. The MCP client and CLI each manage their own credentials.

## Connect the repository

Use `setup_status` and `list_repos` through MCP, or `tripwire status` and `tripwire repos` through the CLI. If Tripwire returns a GitHub App installation link, hand it to the developer. Wait for them to approve access and confirm the installation on Tripwire. Check setup status every 10 to 15 seconds until the repository appears or the attempt times out. If an existing installation omits the repository, ask the developer to add it in GitHub and verify the exact repository again. If access is denied, pending, or tied to the wrong account, report that state before continuing.

## Propose rules and turn on the gate

Inspect the installed rules and the rule catalog with `get_repo_rules` and `list_rule_catalog`, or `tripwire rules list <repo>` and `tripwire rules list --catalog`. Propose a short starting set for the verified repository and explain what each rule would do. Ask the developer before saving rules or turning on the repository gate. After approval, use `set_rule` or `tripwire rules set` for the agreed rules, and `turn_on_gate` or `tripwire gate on <repo>` for activation. Preserve existing rules unless the developer approves changing them. If setup resumes after an interruption, check the saved state before retrying a change.

Report the repository, the rules saved, and whether the gate is on. Share its Tripwire URL when available. As contributions arrive, their runs appear in Activity.
