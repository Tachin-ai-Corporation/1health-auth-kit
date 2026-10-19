-- 1health launch SSO — Better Auth (Postgres / Neon). Links need no schema change (they live in "account").
-- Run with the repo's migration tool or as a script, using the UNPOOLED connection string on Neon.

-- Optional: enforce one row per provider identity (skip if the schema already has it).
create unique index if not exists account_provider_account_uidx on "account" ("providerId", "accountId");

-- Optional: launch audit (identifiers only).
create table if not exists one_health_launch_audit (
  id serial primary key,
  created_at timestamptz not null default now(),
  outcome text not null,               -- success | no_user | pending_confirm | failure
  reason text,
  env text,
  one_health_tenant_id text,
  one_health_user_id text,
  user_id text
);
create index if not exists one_health_launch_audit_created_idx on one_health_launch_audit (created_at desc);

-- Drizzle mirror (lib/db/schema.ts), if the repo keeps one:
-- export const oneHealthLaunchAudit = pgTable("one_health_launch_audit", {
--   id: serial("id").primaryKey(),
--   createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
--   outcome: text("outcome").notNull(), reason: text("reason"), env: text("env"),
--   tenantId: text("one_health_tenant_id"), oneHealthUserId: text("one_health_user_id"), userId: text("user_id"),
-- });
