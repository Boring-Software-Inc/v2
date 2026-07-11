import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * The append-only event store (spec §4/§5). Raw payloads are never mutated or
 * deleted — they are the fixture library, the replay corpus, and the future ML
 * dataset. `deliveryId` UNIQUE is the idempotency guarantee: redelivery = no-op.
 * Ids are UUIDv7 (app-generated via `generateId()`), giving index locality.
 */
export const events = pgTable(
	"events",
	{
		id: text("id").primaryKey(),
		forge: text("forge").notNull().default("github"),
		/** X-GitHub-Delivery. The idempotency key. */
		deliveryId: text("delivery_id").notNull(),
		/** The forge's event name (e.g. "pull_request"), before normalization. */
		rawKind: text("raw_kind").notNull(),
		/** The raw webhook payload, verbatim. Append-only, sacred. */
		raw: jsonb("raw").notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** Normalized columns — populated by the worker (§5.6); null until then. */
		kind: text("kind"),
		repoFullName: text("repo_full_name"),
		actorLogin: text("actor_login"),
		subjectNumber: integer("subject_number"),
		headSha: text("head_sha"),
		/** The full NormalizedEvent (contracts schema, validated on write). */
		normalized: jsonb("normalized"),
		normalizedAt: timestamp("normalized_at", { withTimezone: true }),
		/** §5.5: parse failure ⇒ quarantine + fixture candidate. */
		quarantined: boolean("quarantined").notNull().default(false),
		quarantineReason: text("quarantine_reason"),
	},
	(t) => [
		uniqueIndex("events_delivery_id_unique").on(t.deliveryId),
		index("events_repo_received_idx").on(t.repoFullName, t.receivedAt),
		index("events_kind_idx").on(t.kind),
	],
);
