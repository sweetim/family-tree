import { relations, sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  index,
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

export const session = pgTable("session", {
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
})

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
    dob: text("dob"),
    dod: text("dod"),
    gender: text("gender"),
    location: text("location"),
    photo: text("photo"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("persons_owner_id_updated_at_idx").on(table.ownerId, table.updatedAt),
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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("trees_owner_id_idx").on(table.ownerId)],
)

export const shareRole = pgEnum("share_role", ["viewer", "editor"])

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

// ---------------------------------------------------------------------------
// Relations (used by sync queries — readable shapes only).
// ---------------------------------------------------------------------------

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  ownedPersons: many(persons),
  ownedTrees: many(trees),
  treeShares: many(treeShares),
}))

export const treesRelations = relations(trees, ({ one, many }) => ({
  owner: one(user, { fields: [trees.ownerId], references: [user.id] }),
  shares: many(treeShares),
  members: many(treeMembers),
  unionAssociations: many(treeUnions),
  parentChildRelationshipAssociations: many(treeParentChildRelationships),
}))

export const treeSharesRelations = relations(treeShares, ({ one }) => ({
  tree: one(trees, { fields: [treeShares.treeId], references: [trees.id] }),
  user: one(user, { fields: [treeShares.userId], references: [user.id] }),
}))

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
