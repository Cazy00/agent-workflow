# Deploy, operate, maintain and upgrade

The flow does not end at release. Deployment, operation, maintenance and upgrades use the same records, the same four verification layers and the same authority rules; only the entry points differ. Record the project's actual arrangement in the profile's *Operations* and *Authority* sections. The defaults below apply where the profile is silent.

## Deployment

Name the environments (local, test, staging, production), who deploys to each and how. Default authority: the agent may deploy to the non-production environments the profile names; a production deployment is an owner action or an automatic pipeline from the trusted branch. When production deploys automatically from that branch, the owner's approval of the release pull request is the release authority, so `templates/release.md` must be satisfied before that merge, not after it. Deployment credentials stay outside the agent's reach (POLICY § 9). After every production deployment run the post-release verification the release record names and post the result on the pull request; a failed verification is an incident.

## Incidents and the hotfix lane

An incident is production behaviour that breaks an accepted scenario, loses or exposes data, or stops the service. The coordinator records it as a decision of type `fact` (symptom, affected scenarios, time, evidence), opens a task under the affected milestone or the maintenance milestone, and pauses feature work that touches the affected area. Under an explicit owner instruction the four layers keep their content and relax only their order: capture evidence or reproduce; make the smallest fix with a regression check; verify; deploy through the authorised route; then obtain the independent review within the window the owner set (default: before the end of the next working day) and repeat any check the review invalidates. Rollback is reserved to the owner unless the profile delegates it and the release record shows it was exercised once. Every incident ends with its lesson recorded as a check or an acceptance example, or with a note saying why neither is possible.

## Routine maintenance

Dependency, security and platform updates, certificate and key rotation, backup verification and monitoring review form a standing **maintenance milestone** with its own limits, authorised once and renewed by the owner at each acceptance; each cycle is a task with the normal readiness, checks and review. A backup is verified by restoring it. Findings from monitoring, support requests and user feedback enter discovery as issues on the project repository or items in `docs/workflow/inbox/`; a finding becomes a task under an authorised milestone, or a decision when it changes scope, business behaviour or spending.

## Updates and upgrades

Product changes are new milestones. A project's move to a newer workflow version is a task of its own under an authorised milestone: update the pin in `docs/workflow/config.json`, migrate the records the new schema needs, copy any new scaffold file the project wants from the same release (such as `templates/github/wf-status.yml` into `.github/workflows/`, with the trusted branch filled in), check that CI fetches the full history (`fetch-depth: 0`) that `wf ci` reads, rerun `wf records` and the fixtures, and post the outcome. Active milestones stay on their adopted version unless the owner decides otherwise (`maintenance.md`).

## Authority by stage

Defaults; the profile may delegate or reserve differently, in writing.

| Stage | Delegated to the agent | Reserved to the owner |
|---|---|---|
| Deployment | Non-production environments the profile names; post-release verification | Production deployment and its credentials; release authority |
| Incidents | Declaring, evidence, the smallest fix, verification, scheduling the review | Ordering a hotfix deployment; rollback; communication to customers or users |
| Maintenance | Cycles within the authorised maintenance milestone and its limits | Renewing the milestone; spending beyond limits; data retention and deletion |
| Upgrades | Preparing the upgrade task and record migration | Adopting the new workflow version; changing an active milestone's version |
