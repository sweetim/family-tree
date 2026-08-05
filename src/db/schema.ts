import { relations, sql } from "drizzle-orm"
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

// ---------------------------------------------------------------------------
// Better Auth core tables. Field names must be snake_case (the Drizzle adapter
// default) so the auth instance can read/write them without explicit mapping.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("session_user_id_idx").on(table.userId),
    index("session_expires_at_idx").on(table.expiresAt),
  ],
)

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
})

// ---------------------------------------------------------------------------
// App tables
// ---------------------------------------------------------------------------

export const persons = pgTable(
  "persons",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    familyName: text("family_name").notNull().default(""),
    dob: text("dob"),
    dod: text("dod"),
    gender: text("gender"),
    birthplace: text("birthplace"),
    photo: text("photo"),
    photoUpdatedAt: timestamp("photo_updated_at", { withTimezone: true }),
    revision: integer("revision").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("persons_owner_id_updated_at_idx").on(table.ownerId, table.updatedAt),
    index("persons_name_trgm_idx").using(
      "gin",
      sql`lower(${table.name}) gin_trgm_ops`,
    ),
    check(
      "persons_gender_check",
      sql`${table.gender} IS NULL OR ${table.gender} IN ('male', 'female', 'other')`,
    ),
  ],
)

export const trees = pgTable(
  "trees",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    revision: integer("revision").notNull().default(1),
    syncVersion: bigint("sync_version", { mode: "number" })
      .notNull()
      .default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("trees_owner_id_idx").on(table.ownerId),
    index("trees_owner_created_id_idx").on(
      table.ownerId,
      table.createdAt,
      table.id,
    ),
  ],
)

export const shareRole = pgEnum("share_role", ["viewer", "editor"])

export const accessRequestStatus = pgEnum("access_request_status", [
  "pending",
  "approved",
  "denied",
])

export const treeShares = pgTable(
  "tree_shares",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    role: shareRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.treeId, table.email] }),
    index("tree_shares_user_id_tree_id_idx")
      .on(table.userId, table.treeId)
      .where(sql`${table.userId} IS NOT NULL`),
    index("tree_shares_pending_email_idx")
      .on(table.email)
      .where(sql`${table.userId} IS NULL`),
  ],
)

export const treeAccessRequests = pgTable(
  "tree_access_requests",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    comment: text("comment").notNull(),
    status: accessRequestStatus("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.treeId, table.userId] }),
    index("tree_access_requests_tree_id_status_idx").on(
      table.treeId,
      table.status,
    ),
  ],
)

export const unionEventType = pgEnum("union_event_type", [
  "relationship_started",
  "engaged",
  "married",
  "civil_union",
  "domestic_partnership",
  "separated",
  "reconciled",
  "divorced",
  "annulled",
  "relationship_ended",
])

export const parentChildRelationshipType = pgEnum(
  "parent_child_relationship_type",
  ["biological", "adoptive", "foster", "guardian", "step"],
)

export const treeMembers = pgTable(
  "tree_members",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    personId: text("person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.treeId, table.personId] }),
    index("tree_members_person_id_tree_id_idx").on(
      table.personId,
      table.treeId,
    ),
    index("tree_members_updated_at_idx").on(table.updatedAt),
  ],
)

export const unions = pgTable(
  "unions",
  {
    id: text("id").primaryKey(),
    firstPersonId: text("first_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    secondPersonId: text("second_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "unions_canonical_people_check",
      sql`${table.firstPersonId} COLLATE "C" < ${table.secondPersonId} COLLATE "C"`,
    ),
    check(
      "unions_ascii_people_check",
      sql`octet_length(${table.firstPersonId}) = length(${table.firstPersonId}) AND octet_length(${table.secondPersonId}) = length(${table.secondPersonId})`,
    ),
    index("unions_person_pair_idx").on(
      table.firstPersonId,
      table.secondPersonId,
    ),
    index("unions_second_person_id_idx").on(table.secondPersonId),
    index("unions_updated_at_idx").on(table.updatedAt),
  ],
)

export const unionEvents = pgTable(
  "union_events",
  {
    id: text("id").primaryKey(),
    unionId: text("union_id")
      .notNull()
      .references(() => unions.id, { onDelete: "cascade" }),
    type: unionEventType("type").notNull(),
    eventDate: date("event_date"),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("union_events_union_id_event_date_idx").on(
      table.unionId,
      table.eventDate,
    ),
    index("union_events_updated_at_idx").on(table.updatedAt),
  ],
)

export const treeUnions = pgTable(
  "tree_unions",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    unionId: text("union_id")
      .notNull()
      .references(() => unions.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.treeId, table.unionId] }),
    index("tree_unions_union_id_tree_id_idx").on(table.unionId, table.treeId),
    index("tree_unions_updated_at_idx").on(table.updatedAt),
  ],
)

export const parentChildRelationships = pgTable(
  "parent_child_relationships",
  {
    id: text("id").primaryKey(),
    parentPersonId: text("parent_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    childPersonId: text("child_person_id")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    type: parentChildRelationshipType("type").notNull(),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "parent_child_relationships_distinct_people_check",
      sql`${table.parentPersonId} <> ${table.childPersonId}`,
    ),
    index("parent_child_relationships_parent_child_idx").on(
      table.parentPersonId,
      table.childPersonId,
    ),
    index("parent_child_relationships_child_parent_idx").on(
      table.childPersonId,
      table.parentPersonId,
    ),
    index("parent_child_relationships_active_parent_child_idx")
      .on(table.parentPersonId, table.childPersonId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("parent_child_relationships_active_child_parent_idx")
      .on(table.childPersonId, table.parentPersonId)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("parent_child_relationships_active_parent_child_unique")
      .on(table.parentPersonId, table.childPersonId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("parent_child_relationships_updated_at_idx").on(table.updatedAt),
  ],
)

export const treeParentChildRelationships = pgTable(
  "tree_parent_child_relationships",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    parentChildRelationshipId: text("parent_child_relationship_id")
      .notNull()
      .references(() => parentChildRelationships.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.treeId, table.parentChildRelationshipId],
    }),
    index("tree_parent_child_relationships_relationship_tree_idx").on(
      table.parentChildRelationshipId,
      table.treeId,
    ),
    index("tree_parent_child_relationships_updated_at_idx").on(table.updatedAt),
  ],
)

export const syncChanges = pgTable(
  "sync_changes",
  {
    treeId: text("tree_id")
      .notNull()
      .references(() => trees.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull(),
    mutationId: text("mutation_id").notNull(),
    records: jsonb("records").notNull().$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.treeId, table.version] }),
    index("sync_changes_created_at_idx").on(table.createdAt),
  ],
)

export const mutationReceipts = pgTable(
  "mutation_receipts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mutationId: text("mutation_id").notNull(),
    response: jsonb("response").notNull().$type<unknown>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.mutationId] }),
    index("mutation_receipts_created_at_idx").on(table.createdAt),
  ],
)

// ---------------------------------------------------------------------------
// Relations (used by sync queries — readable shapes only).
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  ownedPersons: many(persons),
  ownedTrees: many(trees),
  treeShares: many(treeShares),
  accessRequests: many(treeAccessRequests),
}))

export const treesRelations = relations(trees, ({ one, many }) => ({
  owner: one(user, { fields: [trees.ownerId], references: [user.id] }),
  shares: many(treeShares),
  members: many(treeMembers),
  unionAssociations: many(treeUnions),
  parentChildRelationshipAssociations: many(treeParentChildRelationships),
  accessRequests: many(treeAccessRequests),
}))

export const treeSharesRelations = relations(treeShares, ({ one }) => ({
  tree: one(trees, { fields: [treeShares.treeId], references: [trees.id] }),
  user: one(user, { fields: [treeShares.userId], references: [user.id] }),
}))

export const treeAccessRequestsRelations = relations(
  treeAccessRequests,
  ({ one }) => ({
    tree: one(trees, {
      fields: [treeAccessRequests.treeId],
      references: [trees.id],
    }),
    user: one(user, {
      fields: [treeAccessRequests.userId],
      references: [user.id],
    }),
  }),
)

export const personsRelations = relations(persons, ({ one, many }) => ({
  owner: one(user, { fields: [persons.ownerId], references: [user.id] }),
  treeMemberships: many(treeMembers),
  unionsAsFirstPerson: many(unions, { relationName: "unionFirstPerson" }),
  unionsAsSecondPerson: many(unions, { relationName: "unionSecondPerson" }),
  parentRelationships: many(parentChildRelationships, {
    relationName: "parentPerson",
  }),
  childRelationships: many(parentChildRelationships, {
    relationName: "childPerson",
  }),
}))

export const treeMembersRelations = relations(treeMembers, ({ one }) => ({
  tree: one(trees, {
    fields: [treeMembers.treeId],
    references: [trees.id],
  }),
  person: one(persons, {
    fields: [treeMembers.personId],
    references: [persons.id],
  }),
}))

export const unionsRelations = relations(unions, ({ one, many }) => ({
  firstPerson: one(persons, {
    fields: [unions.firstPersonId],
    references: [persons.id],
    relationName: "unionFirstPerson",
  }),
  secondPerson: one(persons, {
    fields: [unions.secondPersonId],
    references: [persons.id],
    relationName: "unionSecondPerson",
  }),
  events: many(unionEvents),
  treeAssociations: many(treeUnions),
}))

export const unionEventsRelations = relations(unionEvents, ({ one }) => ({
  union: one(unions, {
    fields: [unionEvents.unionId],
    references: [unions.id],
  }),
}))

export const treeUnionsRelations = relations(treeUnions, ({ one }) => ({
  tree: one(trees, {
    fields: [treeUnions.treeId],
    references: [trees.id],
  }),
  union: one(unions, {
    fields: [treeUnions.unionId],
    references: [unions.id],
  }),
}))

export const parentChildRelationshipsRelations = relations(
  parentChildRelationships,
  ({ one, many }) => ({
    parent: one(persons, {
      fields: [parentChildRelationships.parentPersonId],
      references: [persons.id],
      relationName: "parentPerson",
    }),
    child: one(persons, {
      fields: [parentChildRelationships.childPersonId],
      references: [persons.id],
      relationName: "childPerson",
    }),
    treeAssociations: many(treeParentChildRelationships),
  }),
)

export const treeParentChildRelationshipsRelations = relations(
  treeParentChildRelationships,
  ({ one }) => ({
    tree: one(trees, {
      fields: [treeParentChildRelationships.treeId],
      references: [trees.id],
    }),
    relationship: one(parentChildRelationships, {
      fields: [treeParentChildRelationships.parentChildRelationshipId],
      references: [parentChildRelationships.id],
    }),
  }),
)
