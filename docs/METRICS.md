# Baseline metrics — 2026-08-19

Snapshot taken before Phase 0. Recorded so the Phase 5 dashboards
(TASK-012, TASK-015) have a known-good starting point to reconcile against.

| Metric         | Value  |
| -------------- | ------ |
| Revenue        | $3,240 |
| MRR            | $2,100 |
| Customers      | 18     |
| Active users   | 43     |
| AI cost        | $280   |
| Infrastructure | $90    |
| Gross profit   | $1,730 |
| Margin         | 82%    |

## Derivation

Gross profit and margin are computed against **MRR**, not total revenue:

- `gross_profit = MRR - ai_cost - infrastructure` → `2100 - 280 - 90 = 1730`
- `margin = gross_profit / MRR` → `1730 / 2100 = 82.4%`

The dashboard must use the same basis, or reported margin will drift from
this baseline as one-off revenue accumulates.
