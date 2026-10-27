# MAINT-0021: review what needs it, once, by another vendor

**Status:** adopted in v2.10.0. The owner approved the policy on 18 October 2026: "yeah so let's
approve this what you have just proposed". The plan is `MAINT-0021-plan.md`.

## Why

The owner, on 17 October 2026: "There is no such thing that called perfect output … Those bugs can
be fixed much much cheaply than doing review again and again on the same thing." And: "we need to
put very hard rules for reviewing. Those rules are not meant to restrict review but to make it
more efficient in time, resources and cost."

A study on 17 October 2026 covered:
- a client project: 67 reviews over 24 fix chains, posted as PR comments;
- agent-workflow v2.5.0 to v2.9.0.

What it found:
- **Each round found fewer open findings:**

  | Round | Open findings per review |
  |---|---|
  | 1 | about 5.5 |
  | 2 | about 2.2 |
  | 3 | about 1.6 |
  | 4 | about 1.5 |
  | 5–6 | none |

- **35% of blocking findings (27 of 77) first appeared in round 2 or later.** About two thirds of
  those were half-done fixes of an earlier finding, and one third were bugs the fix itself
  introduced. None were things the first review missed, because fix reviews are scoped to the
  fix diff.
- **The serious late catches were all in permissions, money, data loss and gates:**
  - a privileged function left executable by PUBLIC (T-0006);
  - withheld prices that could be reconstructed (T-0007);
  - the invoice-number race (T-0030 and T-0032);
  - gate bypasses in v2.5.1 and v2.8.0.
- **16 of the 27 late blocking findings were in test or helper code.** All seven merge
  re-reviews found nothing.
- **The cost:**
  - Codex ran out of quota twice in M-0005 and twice more in the owner's workspace.
  - One fourth review of one defect family cost a Codex run and 29 M tokens and changed nothing
    (MAINT-0018 § 4).
  - Reviews launched without an explicit effort ran at Codex's default, low.

## What changes

| Before (v2.9.0) | From v2.10.0 |
|---|---|
| Every production change is reviewed, tests included. | A test-only change needs no review (level `none`): every production path a test path, none an acceptance test, none deep. Verification and integration evidence still apply. |
| Light and standard reviews run on the implementer's own tool. A deep review falls back to it. | Every level is reviewed by another vendor's model. There is no fallback to the implementer's own tool: the next model, or the review is missing and the gate stops. The evidence may name both vendors, and `wf ci` refuses them equal. |
| One review, then at most one review of the fixes, at any level. | One review on the final code. Light and standard get nothing after the fixes, and each blocking fix comes with a test that failed first. Deep and milestone get one fix check, only after a blocking finding, covering only the findings and the fix diff. There is no round three. |
| `review.second_model`, Codex-shaped. | `review.reviewer_command`, optional: one command for every level, with `{role}` filled in. The command chooses the model and its effort, so no one asks the owner. Without it, `second_model` works as before. |
| Severity in the template only. | Blocking, should fix and note defined in the procedure and the templates. Notes never start a round. At most ten findings, and "no findings" is a valid answer. |

## Controls this weakens, and why

- **Test-only changes lose their review.** The study found the late test-code findings did not
  change behaviour that anyone uses. Acceptance tests keep every gate, and so does a test path a
  deep glob names. Weakened or removed required coverage is still blocked mechanically.
- **Light and standard changes lose their review of fixes.** In their place, each blocking fix
  is proven by a test that failed first. Deep and milestone changes, where the serious late
  findings were, keep one fix check.

## What to watch

**Escaped bugs per level:** problems found in use that a review should have caught. If they rise
at one level, tighten that level rather than adding rounds everywhere. The workspace's weekly
report counts them.
