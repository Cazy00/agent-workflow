# MAINT-0019: The owner's merge, from the phone: a tap that a separate executor carries out

**Status:** proposed, 14 October 2026. Not built. It needs the owner's policy decision (below)
before any change to POLICY, templates or the validator.

**Classification** (`procedures/maintenance.md`): improvement proposal. It changes who may
press the merge button in owner-merge mode, which is authority, so it is the owner's policy
decision.

**Owner's words (14 October 2026):** "I want to be able to do absolutely everything from my
phone … when I tell the agent to do something, it needs to be able to do it." On which actions
still need them: merge to production, anything irreversible, new or rotated keys (spec D12,
`Cazy00/workspace`).

---

## 1. What happened

- B1 of MAINT-0017 (the owner's assistant) was never built. Owner merges still mean the owner,
  at a computer, pressing GitHub's merge button.
- Between 12 and 14 October, the merges the policy reserves for the owner were all done that
  way, for example:
  - workflow upgrades: Cazy00/mateen-systems#63, #79 and #85;
  - workflow releases: Cazy00/agent-workflow#47 to #50.
- Each one waited until the owner was at a computer.

## 2. Why

- In owner-merge mode the owner's merge is the approval, and nothing records more than "the
  owner's account merged".
- The only way to give that approval is GitHub's own merge button, in a session that holds the
  owner's account. B1 would have given an AI session that account; the owner never adopted it.

## 3. The change

**C1. An owner-authorized executor** (POLICY § 7, owner-merge mode; `identity.md`).
- The owner may name an executor: a GitHub App installed on the repository. It is separate from
  every worker identity, and its key lives where worker accounts can't read it.
- The executor merges only after the owner's tap on a message the executor's own service wrote.
  The message shows:
  - the repository, the PR number and the exact head commit;
  - the PR's title, labelled as the PR's own words.
- The tap is bound to that request:
  - it is used once and expires after 30 minutes;
  - the head commit, base branch and checks are re-read before the merge;
  - the merge call names the approved commit, so a push after the tap merges nothing.
- After merging, the executor posts an **approval receipt** on the PR: request id, request
  digest, approved head commit and time.
- The executor never merges on a worker's request alone. A worker may ask; only the owner's tap
  starts the merge.

**C2. The gate accepts the receipt.** In owner-merge mode, `wf ci` treats a merge by the named
executor as the owner's merge only when the PR carries a receipt whose head commit is the
merged head.
- Check: `wf ci` fails such a merge without a receipt, and fails one whose receipt names another
  commit (`checkpoints.test.js`, two cases).

## 4. What stays as it is

- §§ 350–362: worker identity, and no fallback to the owner account.
- B1's limit: nothing approves on its own judgement. Here the approval is a tap by the owner;
  the executor's judgement is never asked.
- Agents never approve and never sign.
- Owner-merge mode's honesty: the setup record still says nothing *proves* who tapped. The
  receipt proves that a tap bound to that exact commit happened through the owner's channel; it
  does not make the mode equivalent to enforcement.

## 5. Not in this change

- The executor's service itself. It lives in `Cazy00/workspace` (`broker/`, operation
  `github-merge`), outside this repository, by the modularity rule.
- Approvals that aren't merges (acceptance, protected-material review).

## 6. How we will know

The next workflow upgrade PR in Cazy00/mateen-systems is merged from the owner's phone. Its
receipt names its head commit, and `wf ci` passes on `main` afterwards.
