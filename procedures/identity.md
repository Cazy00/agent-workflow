# Verify the publishing identity

Account references: personal owner `oman.m123456@gmail.com`; development worker `almuntaser.dev@gmail.com`. Verify actual GitHub usernames; emails and commit metadata do not authenticate a GitHub session. The AI-service login is a separate identity.

**One account.** The owner may choose to give the agent no account of its own (`bin/wf-adopt` without `--worker`; `setup.md`, *Choose the arrangement*). The agent then publishes with the owner's account and this procedure's worker checks do not apply: there is no separate clone, worker token or worker username to verify. Record the choice in the profile's *Authority*. GitHub then cannot tell the agent's actions from the owner's, so enforced mode is unavailable, and any approval the owner gives must come from what the agent cannot reach: receipts signed with a passphrase-protected key (manual mode), or, knowingly unproven, the owner's own merge (owner-merge mode). The rest of this procedure applies when a worker account exists.

In a shared project each person does all of this with their own accounts, clone and worker token, never another person's (`shared.md`). Keep the personal owner clone and the agent clone separate. Configure commit author metadata, Git transport credentials, and GitHub API/CLI credentials independently and locally. Use worker worktrees only for task isolation. Never switch machine-global Git or GitHub accounts for routine agent work. Preserve genuine human attribution, including when moving or integrating human changes. Store credentials in the OS secret store or a restricted worker environment, never repository files.

The terminal adapter supports GitHub.com HTTPS and `gh` with an explicitly supplied worker token. From the agent clone, run:

```sh
node /trusted/workflow/adapters/identity.mjs OWNER/REPOSITORY WORKER_USERNAME codex/T-0001-work
```

Provision `WF_WORKER_TOKEN` from worker secret storage in that process's environment; do not paste the token into a task, repository, command transcript or receipt. The adapter fails before any account lookup when the worker token is absent, verifies its API identity and personal repository target, checks current branch and push URL, and probes Git using an isolated credential route. It never falls back to owner credentials or modifies global settings.

The adapter is read-only. A public repository may permit an anonymous read, so a successful Git read does **not** prove worker push permission. It also does not establish commit attribution or release/decision authority. Before publishing, separately verify local author settings, current target and applicable milestone authority, and ensure the actual publishing command uses the same explicit worker credential route. Record the action's authenticated identity and result. The live approval-path test establishes permitted writes and rejected bypasses.

Connector, desktop integration, SSH, and other publishing routes require their own authenticated-identity evidence and representative test before use. They are not covered by the terminal adapter. Missing/expired worker credentials block publishing; unrelated authorised local work may continue. Practical configuration separation is not strong credential isolation: that requires an environment tested to be unable to access owner credentials.
