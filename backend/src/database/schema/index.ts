/**
 * The schema barrel. Feature tables are added by the tasks that own them —
 * users in TASK-003, organizations in TASK-004 — and each one builds on
 * ./columns rather than declaring its own id and timestamp shapes.
 */
export { idColumn, timestamps } from './columns'
