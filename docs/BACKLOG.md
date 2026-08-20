# OneStack Backlog

Canonical task list. IDs are stable and never reused. Every task ships with a
spec ([templates/SPEC.md](templates/SPEC.md)) and passes both review gates
([templates/REVIEW.md](templates/REVIEW.md)) before it is marked done.

| ID       | Task                     | Phase            | Depends on         | Status      |
| -------- | ------------------------ | ---------------- | ------------------ | ----------- |
| TASK-001 | Project foundation       | 0 — Foundation   | —                  | Done        |
| TASK-002 | Database architecture    | 0 — Foundation   | TASK-001           | Done        |
| TASK-003 | Authentication           | 1 — Core         | TASK-002           | Done        |
| TASK-004 | Organization / Workspace | 1 — Core         | TASK-003           | Done        |
| TASK-005 | User management          | 1 — Core         | TASK-004           | Done        |
| TASK-006 | Customer CRM             | 2 — Business     | TASK-005           | Done        |
| TASK-007 | Product management       | 2 — Business     | TASK-005           | Done        |
| TASK-008 | Subscription             | 2 — Business     | TASK-006, TASK-007 | Done        |
| TASK-009 | AI provider abstraction  | 3 — AI           | TASK-004           | Not started |
| TASK-010 | AI usage tracking        | 3 — AI           | TASK-009           | Not started |
| TASK-011 | Automation engine        | 4 — Automation   | TASK-009           | Not started |
| TASK-012 | Analytics                | 5 — Intelligence | TASK-008, TASK-010 | Not started |
| TASK-013 | Billing                  | 2 — Business     | TASK-008           | Not started |
| TASK-014 | Audit logs               | cross-cutting    | TASK-002           | Not started |
| TASK-015 | Dashboard                | 5 — Intelligence | TASK-012           | Not started |
| TASK-016 | Testing                  | cross-cutting    | TASK-001           | Not started |
| TASK-017 | Security hardening       | 6 — Production   | TASK-003           | Not started |
| TASK-018 | Production deployment    | 6 — Production   | TASK-017           | Not started |

## Notes

- Task names and IDs are as specified. The **Phase** and **Depends on**
  columns are derived from [ROADMAP.md](ROADMAP.md) — adjust them freely, they
  are sequencing aids, not commitments.
- TASK-014 (Audit logs) and TASK-016 (Testing) are cross-cutting: CLAUDE.md
  rules 7 and 10 apply to every feature, so these tasks cover the shared
  infrastructure, not the per-feature work.
- TASK-013 (Billing) belongs to Phase 2 but is sequenced after the AI tasks by
  ID. Build it whenever Phase 2 revenue work demands it.
