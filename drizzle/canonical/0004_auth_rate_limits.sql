-- weyne:migration compatibility=expand previous-app-compatible=true
-- Persist Better Auth's rate-limit counters in PostgreSQL.
--
-- Better Auth's default rate-limit storage is an in-process Map. That is
-- adequate for a single long-lived process and worthless for this deployment:
-- the container is replaced on every release, and an in-flight brute-force
-- window is forgotten the moment it restarts. Moving the counters into the
-- database makes the limit survive a restart and hold across replicas.
--
-- The table is owned by the library, not by the business domain, so it
-- deliberately carries no authorship, no archive column, and no audit
-- trigger. Rows are transient: the library prunes each one once its window
-- has lapsed, which is what `rate_limits_last_request_idx` supports.
--
-- `key` is UNIQUE because the storage adapter's atomicity depends on it. Each
-- request performs a guarded `UPDATE ... WHERE key = $1 AND count < max`, and
-- PostgreSQL's row lock is what stops two concurrent requests from both
-- reading a stale count and both being allowed through. A duplicate key would
-- silently split a bucket in two and double the effective limit.
--
-- `last_request` is epoch milliseconds rather than timestamptz: milliseconds
-- are the unit Better Auth compares against its window, and a timestamptz
-- would force a lossy conversion on every read of a hot path.
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_uq" UNIQUE("key"),
	CONSTRAINT "rate_limits_key_ck" CHECK (btrim("rate_limits"."key") <> ''),
	CONSTRAINT "rate_limits_count_ck" CHECK ("rate_limits"."count" >= 0),
	CONSTRAINT "rate_limits_last_request_ck" CHECK ("rate_limits"."last_request" >= 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limits_last_request_idx" ON "rate_limits" USING btree ("last_request");
