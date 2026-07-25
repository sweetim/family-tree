CREATE TYPE "public"."parent_child_relationship_type" AS ENUM('biological', 'adoptive', 'foster', 'guardian', 'step');
--> statement-breakpoint
CREATE TYPE "public"."union_event_type" AS ENUM('relationship_started', 'engaged', 'married', 'civil_union', 'domestic_partnership', 'separated', 'reconciled', 'divorced', 'annulled', 'relationship_ended');
--> statement-breakpoint
CREATE TABLE "parent_child_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_person_id" text NOT NULL,
	"child_person_id" text NOT NULL,
	"type" "parent_child_relationship_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "parent_child_relationships_distinct_people_check" CHECK ("parent_child_relationships"."parent_person_id" <> "parent_child_relationships"."child_person_id")
);
--> statement-breakpoint
CREATE TABLE "tree_members" (
	"tree_id" text NOT NULL,
	"person_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tree_members_tree_id_person_id_pk" PRIMARY KEY("tree_id", "person_id")
);
--> statement-breakpoint
CREATE TABLE "tree_parent_child_relationships" (
	"tree_id" text NOT NULL,
	"parent_child_relationship_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tree_parent_child_relationships_tree_id_parent_child_relationship_id_pk" PRIMARY KEY("tree_id", "parent_child_relationship_id")
);
--> statement-breakpoint
CREATE TABLE "tree_unions" (
	"tree_id" text NOT NULL,
	"union_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tree_unions_tree_id_union_id_pk" PRIMARY KEY("tree_id", "union_id")
);
--> statement-breakpoint
CREATE TABLE "union_events" (
	"id" text PRIMARY KEY NOT NULL,
	"union_id" text NOT NULL,
	"type" "union_event_type" NOT NULL,
	"event_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unions" (
	"id" text PRIMARY KEY NOT NULL,
	"first_person_id" text NOT NULL,
	"second_person_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "unions_canonical_people_check" CHECK ("unions"."first_person_id" COLLATE "C" < "unions"."second_person_id" COLLATE "C"),
	CONSTRAINT "unions_ascii_people_check" CHECK (octet_length("unions"."first_person_id") = length("unions"."first_person_id") AND octet_length("unions"."second_person_id") = length("unions"."second_person_id"))
);
--> statement-breakpoint
ALTER TABLE "parent_child_relationships" ADD CONSTRAINT "parent_child_relationships_parent_person_id_persons_id_fk" FOREIGN KEY ("parent_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "parent_child_relationships" ADD CONSTRAINT "parent_child_relationships_child_person_id_persons_id_fk" FOREIGN KEY ("child_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tree_members" ADD CONSTRAINT "tree_members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tree_parent_child_relationships" ADD CONSTRAINT "tree_parent_child_relationships_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tree_parent_child_relationships" ADD CONSTRAINT "tree_parent_child_relationships_parent_child_relationship_id_parent_child_relationships_id_fk" FOREIGN KEY ("parent_child_relationship_id") REFERENCES "public"."parent_child_relationships"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tree_unions" ADD CONSTRAINT "tree_unions_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tree_unions" ADD CONSTRAINT "tree_unions_union_id_unions_id_fk" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "union_events" ADD CONSTRAINT "union_events_union_id_unions_id_fk" FOREIGN KEY ("union_id") REFERENCES "public"."unions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_first_person_id_persons_id_fk" FOREIGN KEY ("first_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "unions" ADD CONSTRAINT "unions_second_person_id_persons_id_fk" FOREIGN KEY ("second_person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- This lock blocks legacy relationship/person writes for the full transaction.
-- A maintenance window is still required because old application instances are
-- incompatible with the normalized target after trees.edges is dropped.
LOCK TABLE "persons", "trees" IN SHARE MODE;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'trees'
			AND column_name = 'edges'
			AND data_type = 'jsonb'
			AND is_nullable = 'NO'
	) THEN
		RAISE EXCEPTION 'Normalization requires public.trees.edges to be a non-null jsonb column';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name IN ('persons', 'trees')
			AND column_name = 'id'
			AND data_type <> 'text'
	) THEN
		RAISE EXCEPTION 'Normalization requires persons.id and trees.id to remain text';
	END IF;
END
$$;
--> statement-breakpoint
CREATE TEMP TABLE "_normalization_issues" (
	"code" text NOT NULL,
	"details" text NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.abort_family_normalization_if_issues(stage text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	issue_count bigint;
	issue_summary text;
BEGIN
	SELECT count(*) INTO issue_count FROM "_normalization_issues";
	IF issue_count = 0 THEN
		RETURN;
	END IF;

	SELECT string_agg(format('[%s] %s', code, details), '; ' ORDER BY code, details)
	INTO issue_summary
	FROM (
		SELECT code, details
		FROM "_normalization_issues"
		ORDER BY code, details
		LIMIT 20
	) AS bounded_issues;

	RAISE EXCEPTION USING
		MESSAGE = format(
			'Family normalization aborted during %s with %s issue(s): %s',
			stage,
			issue_count,
			issue_summary
		),
		HINT = 'Correct the legacy trees.edges data and rerun the transactional migration.';
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.is_exact_iso_date(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
	parsed_date date;
BEGIN
	IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
		RETURN false;
	END IF;
	parsed_date := value::date;
	RETURN parsed_date::text = value;
EXCEPTION
	WHEN others THEN RETURN false;
END
$$;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'invalid_person_gender', format('person=%s gender=%s', id, gender)
FROM "persons"
WHERE gender IS NOT NULL
	AND gender NOT IN ('male', 'female', 'other')
UNION ALL
SELECT 'non_ascii_person_id', format('person=%s', id)
FROM "persons"
WHERE octet_length(id) <> length(id);
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('legacy person validation');
--> statement-breakpoint
ALTER TABLE "persons" ADD CONSTRAINT "persons_gender_check" CHECK ("persons"."gender" IS NULL OR "persons"."gender" IN ('male', 'female', 'other'));
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'malformed_edges', format('tree=%s edges must be an object', id)
FROM "trees"
WHERE jsonb_typeof(edges) IS DISTINCT FROM 'object';
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('top-level edge validation');
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'malformed_edges', format('tree=%s members must be an array', id)
FROM "trees"
WHERE jsonb_typeof(edges -> 'members') IS DISTINCT FROM 'array'
UNION ALL
SELECT 'malformed_edges', format('tree=%s spouses must be an array', id)
FROM "trees"
WHERE jsonb_typeof(edges -> 'spouses') IS DISTINCT FROM 'array'
UNION ALL
SELECT 'malformed_edges', format('tree=%s parents must be an object', id)
FROM "trees"
WHERE jsonb_typeof(edges -> 'parents') IS DISTINCT FROM 'object'
UNION ALL
SELECT DISTINCT 'malformed_edges', format('tree=%s unsupported key=%s', tree.id, edge_key.key)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_object_keys(tree.edges) AS edge_key(key)
WHERE edge_key.key NOT IN ('members', 'spouses', 'parents');
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('edge collection validation');
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'malformed_member', format('tree=%s member_index=%s must be a nonempty string', tree.id, member.ordinal)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'members') WITH ORDINALITY AS member(value, ordinal)
WHERE jsonb_typeof(member.value) IS DISTINCT FROM 'string'
	OR COALESCE(member.value #>> '{}', '') = ''
UNION ALL
SELECT 'malformed_spouse', format('tree=%s spouse_index=%s must be an object or exact two-person tuple', tree.id, spouse.ordinal)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'spouses') WITH ORDINALITY AS spouse(value, ordinal)
WHERE CASE jsonb_typeof(spouse.value)
	WHEN 'object' THEN false
	WHEN 'array' THEN jsonb_array_length(spouse.value) <> 2
	ELSE true
END
UNION ALL
SELECT 'malformed_parent_list', format('tree=%s child=%s parents must be an array', tree.id, parent_entry.child_person_id)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_each(tree.edges -> 'parents') AS parent_entry(child_person_id, parent_values)
WHERE parent_entry.child_person_id = ''
	OR jsonb_typeof(parent_entry.parent_values) IS DISTINCT FROM 'array';
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('edge element validation');
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'malformed_parent', format('tree=%s child=%s parent_index=%s must be an object', tree.id, parent_entry.child_person_id, parent_link.ordinal)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_each(tree.edges -> 'parents') AS parent_entry(child_person_id, parent_values)
CROSS JOIN LATERAL jsonb_array_elements(parent_entry.parent_values) WITH ORDINALITY AS parent_link(value, ordinal)
WHERE jsonb_typeof(parent_link.value) IS DISTINCT FROM 'object';
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('parent element validation');
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'malformed_spouse', format('tree=%s spouse_index=%s has invalid fields', tree.id, spouse.ordinal)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'spouses') WITH ORDINALITY AS spouse(value, ordinal)
WHERE jsonb_typeof(spouse.value) = 'object'
	AND (
	NOT (spouse.value ? 'a')
	OR jsonb_typeof(spouse.value -> 'a') IS DISTINCT FROM 'string'
	OR COALESCE(spouse.value ->> 'a', '') = ''
	OR NOT (spouse.value ? 'b')
	OR jsonb_typeof(spouse.value -> 'b') IS DISTINCT FROM 'string'
	OR COALESCE(spouse.value ->> 'b', '') = ''
	OR (
		spouse.value ? 'date'
		AND jsonb_typeof(spouse.value -> 'date') NOT IN ('string', 'null')
	)
	OR EXISTS (
		SELECT 1
		FROM jsonb_object_keys(spouse.value) AS spouse_key(key)
		WHERE spouse_key.key NOT IN ('a', 'b', 'date')
	)
	)
UNION ALL
SELECT 'malformed_spouse', format('tree=%s spouse_index=%s tuple must contain two nonempty strings', tree.id, spouse.ordinal)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'spouses') WITH ORDINALITY AS spouse(value, ordinal)
WHERE jsonb_typeof(spouse.value) = 'array'
	AND (
		jsonb_typeof(spouse.value -> 0) IS DISTINCT FROM 'string'
		OR COALESCE(spouse.value ->> 0, '') = ''
		OR jsonb_typeof(spouse.value -> 1) IS DISTINCT FROM 'string'
		OR COALESCE(spouse.value ->> 1, '') = ''
	)
UNION ALL
SELECT 'malformed_parent', format('tree=%s child=%s parent_index=%s has invalid fields', tree.id, parent_entry.child_person_id, parent_link.ordinal)
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_each(tree.edges -> 'parents') AS parent_entry(child_person_id, parent_values)
CROSS JOIN LATERAL jsonb_array_elements(parent_entry.parent_values) WITH ORDINALITY AS parent_link(value, ordinal)
WHERE NOT (parent_link.value ? 'id')
	OR jsonb_typeof(parent_link.value -> 'id') IS DISTINCT FROM 'string'
	OR COALESCE(parent_link.value ->> 'id', '') = ''
	OR (
		parent_link.value ? 'adopted'
		AND jsonb_typeof(parent_link.value -> 'adopted') IS DISTINCT FROM 'boolean'
	)
	OR EXISTS (
		SELECT 1
		FROM jsonb_object_keys(parent_link.value) AS parent_key(key)
		WHERE parent_key.key NOT IN ('id', 'adopted')
	);
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'malformed_marriage_date', format('tree=%s spouse_index=%s date=%s', tree.id, spouse.ordinal, spouse.value ->> 'date')
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'spouses') WITH ORDINALITY AS spouse(value, ordinal)
WHERE jsonb_typeof(spouse.value) = 'object'
	AND COALESCE(spouse.value ->> 'date', '') <> ''
	AND NOT pg_temp.is_exact_iso_date(spouse.value ->> 'date');
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('edge field validation');
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_members" (
	"tree_id" text NOT NULL,
	"person_id" text NOT NULL,
	"source_ordinal" bigint NOT NULL,
	"tree_created_at" timestamp with time zone NOT NULL,
	"tree_updated_at" timestamp with time zone NOT NULL,
	"tree_deleted_at" timestamp with time zone
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO "_legacy_members" ("tree_id", "person_id", "source_ordinal", "tree_created_at", "tree_updated_at", "tree_deleted_at")
SELECT tree.id, member.value #>> '{}', member.ordinal, tree.created_at, tree.updated_at, tree.deleted_at
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'members') WITH ORDINALITY AS member(value, ordinal);
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_parent_lists" (
	"tree_id" text NOT NULL,
	"child_person_id" text NOT NULL
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO "_legacy_parent_lists" ("tree_id", "child_person_id")
SELECT tree.id, parent_entry.child_person_id
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_each(tree.edges -> 'parents') AS parent_entry(child_person_id, parent_values);
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_spouses" (
	"tree_id" text NOT NULL,
	"first_person_id" text NOT NULL,
	"second_person_id" text NOT NULL,
	"event_date" date,
	"source_ordinal" bigint NOT NULL,
	"tree_created_at" timestamp with time zone NOT NULL,
	"tree_updated_at" timestamp with time zone NOT NULL,
	"tree_deleted_at" timestamp with time zone
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO "_legacy_spouses" ("tree_id", "first_person_id", "second_person_id", "event_date", "source_ordinal", "tree_created_at", "tree_updated_at", "tree_deleted_at")
SELECT
	tree.id,
	LEAST(endpoint.first_id COLLATE "C", endpoint.second_id COLLATE "C"),
	GREATEST(endpoint.first_id COLLATE "C", endpoint.second_id COLLATE "C"),
	CASE
		WHEN COALESCE(endpoint.event_date, '') = '' THEN NULL
		ELSE endpoint.event_date::date
	END,
	spouse.ordinal,
	tree.created_at,
	tree.updated_at,
	tree.deleted_at
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_array_elements(tree.edges -> 'spouses') WITH ORDINALITY AS spouse(value, ordinal)
CROSS JOIN LATERAL (
	SELECT
		CASE WHEN jsonb_typeof(spouse.value) = 'array' THEN spouse.value ->> 0 ELSE spouse.value ->> 'a' END AS first_id,
		CASE WHEN jsonb_typeof(spouse.value) = 'array' THEN spouse.value ->> 1 ELSE spouse.value ->> 'b' END AS second_id,
		CASE WHEN jsonb_typeof(spouse.value) = 'array' THEN NULL ELSE spouse.value ->> 'date' END AS event_date
) AS endpoint;
--> statement-breakpoint
CREATE TEMP TABLE "_legacy_parent_relationships" (
	"tree_id" text NOT NULL,
	"parent_person_id" text NOT NULL,
	"child_person_id" text NOT NULL,
	"relationship_type" text NOT NULL,
	"source_ordinal" bigint NOT NULL,
	"tree_created_at" timestamp with time zone NOT NULL,
	"tree_updated_at" timestamp with time zone NOT NULL,
	"tree_deleted_at" timestamp with time zone
) ON COMMIT DROP;
--> statement-breakpoint
INSERT INTO "_legacy_parent_relationships" ("tree_id", "parent_person_id", "child_person_id", "relationship_type", "source_ordinal", "tree_created_at", "tree_updated_at", "tree_deleted_at")
SELECT
	tree.id,
	parent_link.value ->> 'id',
	parent_entry.child_person_id,
	CASE
		WHEN COALESCE((parent_link.value ->> 'adopted')::boolean, false) THEN 'adoptive'
		ELSE 'biological'
	END,
	row_number() OVER (
		PARTITION BY tree.id
		ORDER BY parent_entry.ordinal, parent_link.ordinal
	),
	tree.created_at,
	tree.updated_at,
	tree.deleted_at
FROM "trees" AS tree
CROSS JOIN LATERAL jsonb_each(tree.edges -> 'parents') WITH ORDINALITY AS parent_entry(child_person_id, parent_values, ordinal)
CROSS JOIN LATERAL jsonb_array_elements(parent_entry.parent_values) WITH ORDINALITY AS parent_link(value, ordinal);
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'duplicate_member', format('tree=%s person=%s count=%s', tree_id, person_id, count(*))
FROM "_legacy_members"
GROUP BY tree_id, person_id
HAVING count(*) > 1
UNION ALL
SELECT 'dangling_member', format('tree=%s person=%s', member.tree_id, member.person_id)
FROM "_legacy_members" AS member
LEFT JOIN "persons" AS person ON person.id = member.person_id
WHERE person.id IS NULL
UNION ALL
SELECT 'active_tree_tombstoned_person', format('tree=%s person=%s', member.tree_id, member.person_id)
FROM "_legacy_members" AS member
INNER JOIN "persons" AS person ON person.id = member.person_id
WHERE member.tree_deleted_at IS NULL
	AND person.deleted_at IS NOT NULL
UNION ALL
SELECT 'dangling_parent_child', format('tree=%s child=%s', parent_list.tree_id, parent_list.child_person_id)
FROM "_legacy_parent_lists" AS parent_list
LEFT JOIN "persons" AS child ON child.id = parent_list.child_person_id
WHERE child.id IS NULL
UNION ALL
SELECT 'nonmember_parent_child', format('tree=%s child=%s', parent_list.tree_id, parent_list.child_person_id)
FROM "_legacy_parent_lists" AS parent_list
LEFT JOIN "_legacy_members" AS member
	ON member.tree_id = parent_list.tree_id
	AND member.person_id = parent_list.child_person_id
WHERE member.person_id IS NULL;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'duplicate_spouse', format('tree=%s people=(%s,%s) count=%s', tree_id, first_person_id, second_person_id, count(*))
FROM "_legacy_spouses"
GROUP BY tree_id, first_person_id, second_person_id
HAVING count(*) > 1
UNION ALL
SELECT 'self_spouse', format('tree=%s person=%s', tree_id, first_person_id)
FROM "_legacy_spouses"
WHERE first_person_id = second_person_id
UNION ALL
SELECT 'dangling_spouse', format('tree=%s person=%s', spouse.tree_id, spouse.first_person_id)
FROM "_legacy_spouses" AS spouse
LEFT JOIN "persons" AS person ON person.id = spouse.first_person_id
WHERE person.id IS NULL
UNION ALL
SELECT 'dangling_spouse', format('tree=%s person=%s', spouse.tree_id, spouse.second_person_id)
FROM "_legacy_spouses" AS spouse
LEFT JOIN "persons" AS person ON person.id = spouse.second_person_id
WHERE person.id IS NULL
UNION ALL
SELECT 'nonmember_spouse', format('tree=%s person=%s', spouse.tree_id, spouse.first_person_id)
FROM "_legacy_spouses" AS spouse
LEFT JOIN "_legacy_members" AS member
	ON member.tree_id = spouse.tree_id
	AND member.person_id = spouse.first_person_id
WHERE member.person_id IS NULL
UNION ALL
SELECT 'nonmember_spouse', format('tree=%s person=%s', spouse.tree_id, spouse.second_person_id)
FROM "_legacy_spouses" AS spouse
LEFT JOIN "_legacy_members" AS member
	ON member.tree_id = spouse.tree_id
	AND member.person_id = spouse.second_person_id
WHERE member.person_id IS NULL
UNION ALL
SELECT 'conflicting_marriage_dates', format('people=(%s,%s) dates=%s', first_person_id, second_person_id, array_agg(DISTINCT event_date ORDER BY event_date))
FROM "_legacy_spouses"
WHERE event_date IS NOT NULL
GROUP BY first_person_id, second_person_id
HAVING count(DISTINCT event_date) > 1;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'duplicate_parent_relationship', format('tree=%s parent=%s child=%s count=%s', tree_id, parent_person_id, child_person_id, count(*))
FROM "_legacy_parent_relationships"
GROUP BY tree_id, parent_person_id, child_person_id
HAVING count(*) > 1
UNION ALL
SELECT 'self_parent', format('tree=%s person=%s', tree_id, parent_person_id)
FROM "_legacy_parent_relationships"
WHERE parent_person_id = child_person_id
UNION ALL
SELECT 'dangling_parent', format('tree=%s parent=%s', relationship.tree_id, relationship.parent_person_id)
FROM "_legacy_parent_relationships" AS relationship
LEFT JOIN "persons" AS parent ON parent.id = relationship.parent_person_id
WHERE parent.id IS NULL
UNION ALL
SELECT 'dangling_child', format('tree=%s child=%s', relationship.tree_id, relationship.child_person_id)
FROM "_legacy_parent_relationships" AS relationship
LEFT JOIN "persons" AS child ON child.id = relationship.child_person_id
WHERE child.id IS NULL
UNION ALL
SELECT 'nonmember_parent', format('tree=%s parent=%s', relationship.tree_id, relationship.parent_person_id)
FROM "_legacy_parent_relationships" AS relationship
LEFT JOIN "_legacy_members" AS member
	ON member.tree_id = relationship.tree_id
	AND member.person_id = relationship.parent_person_id
WHERE member.person_id IS NULL
UNION ALL
SELECT 'nonmember_child', format('tree=%s child=%s', relationship.tree_id, relationship.child_person_id)
FROM "_legacy_parent_relationships" AS relationship
LEFT JOIN "_legacy_members" AS member
	ON member.tree_id = relationship.tree_id
	AND member.person_id = relationship.child_person_id
WHERE member.person_id IS NULL
UNION ALL
SELECT 'conflicting_parent_types', format('parent=%s child=%s types=%s', parent_person_id, child_person_id, array_agg(DISTINCT relationship_type ORDER BY relationship_type))
FROM "_legacy_parent_relationships"
GROUP BY parent_person_id, child_person_id
HAVING count(DISTINCT relationship_type) > 1;
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('relationship integrity validation');
--> statement-breakpoint
CREATE TEMP TABLE "_normalization_unions" ON COMMIT DROP AS
SELECT
	'migrated_union_' || md5(
		length(first_person_id)::text || ':' || first_person_id || ':' ||
		length(second_person_id)::text || ':' || second_person_id
	) AS id,
	'migrated_union_event_' || md5(
		'married:' || length(first_person_id)::text || ':' || first_person_id || ':' ||
		length(second_person_id)::text || ':' || second_person_id
	) AS event_id,
	first_person_id,
	second_person_id,
	max(event_date) AS event_date,
	min(tree_created_at + (source_ordinal - 1) * interval '1 millisecond') AS created_at,
	max(GREATEST(
		tree_updated_at,
		tree_created_at + (source_ordinal - 1) * interval '1 millisecond',
		COALESCE(tree_deleted_at, '-infinity'::timestamp with time zone)
	)) AS updated_at,
	CASE
		WHEN bool_or(tree_deleted_at IS NULL) THEN NULL
		ELSE max(tree_deleted_at)
	END AS deleted_at
FROM "_legacy_spouses"
GROUP BY first_person_id, second_person_id;
--> statement-breakpoint
CREATE TEMP TABLE "_normalization_parent_relationships" ON COMMIT DROP AS
SELECT
	'migrated_parent_child_' || md5(
		length(parent_person_id)::text || ':' || parent_person_id || ':' ||
		length(child_person_id)::text || ':' || child_person_id
	) AS id,
	parent_person_id,
	child_person_id,
	min(relationship_type) AS relationship_type,
	min(tree_created_at + (source_ordinal - 1) * interval '1 millisecond') AS created_at,
	max(GREATEST(
		tree_updated_at,
		tree_created_at + (source_ordinal - 1) * interval '1 millisecond',
		COALESCE(tree_deleted_at, '-infinity'::timestamp with time zone)
	)) AS updated_at,
	CASE
		WHEN bool_or(tree_deleted_at IS NULL) THEN NULL
		ELSE max(tree_deleted_at)
	END AS deleted_at
FROM "_legacy_parent_relationships"
GROUP BY parent_person_id, child_person_id;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'too_many_active_parents', format('child=%s active_parent_count=%s', child_person_id, count(DISTINCT parent_person_id))
FROM "_normalization_parent_relationships"
WHERE deleted_at IS NULL
GROUP BY child_person_id
HAVING count(DISTINCT parent_person_id) > 2;
--> statement-breakpoint
WITH RECURSIVE active_parent_edges AS (
	SELECT parent_person_id, child_person_id
	FROM "_normalization_parent_relationships"
	WHERE deleted_at IS NULL
), ancestry(descendant_person_id, ancestor_person_id) AS (
	SELECT child_person_id, parent_person_id
	FROM active_parent_edges
	UNION
	SELECT ancestry.descendant_person_id, active_parent_edges.parent_person_id
	FROM ancestry
	INNER JOIN active_parent_edges
		ON active_parent_edges.child_person_id = ancestry.ancestor_person_id
)
INSERT INTO "_normalization_issues" ("code", "details")
SELECT DISTINCT 'active_ancestry_cycle', format('person=%s', descendant_person_id)
FROM ancestry
WHERE descendant_person_id = ancestor_person_id;
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('active global parent graph validation');
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'synthetic_union_id_collision', format('id=%s count=%s', id, count(*))
FROM "_normalization_unions"
GROUP BY id
HAVING count(*) > 1
UNION ALL
SELECT 'synthetic_union_event_id_collision', format('id=%s count=%s', event_id, count(*))
FROM "_normalization_unions"
GROUP BY event_id
HAVING count(*) > 1
UNION ALL
SELECT 'synthetic_parent_relationship_id_collision', format('id=%s count=%s', id, count(*))
FROM "_normalization_parent_relationships"
GROUP BY id
HAVING count(*) > 1;
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('synthetic identifier validation');
--> statement-breakpoint
INSERT INTO "tree_members" ("tree_id", "person_id", "created_at", "updated_at", "deleted_at")
SELECT
	tree_id,
	person_id,
	tree_created_at + (source_ordinal - 1) * interval '1 millisecond',
	GREATEST(
		tree_updated_at,
		tree_created_at + (source_ordinal - 1) * interval '1 millisecond',
		COALESCE(tree_deleted_at, '-infinity'::timestamp with time zone)
	),
	tree_deleted_at
FROM "_legacy_members";
--> statement-breakpoint
INSERT INTO "unions" ("id", "first_person_id", "second_person_id", "created_at", "updated_at", "deleted_at")
SELECT id, first_person_id, second_person_id, created_at, updated_at, deleted_at
FROM "_normalization_unions";
--> statement-breakpoint
INSERT INTO "union_events" ("id", "union_id", "type", "event_date", "created_at", "updated_at", "deleted_at")
SELECT event_id, id, 'married'::"union_event_type", event_date, created_at, updated_at, deleted_at
FROM "_normalization_unions";
--> statement-breakpoint
INSERT INTO "tree_unions" ("tree_id", "union_id", "created_at", "updated_at", "deleted_at")
SELECT DISTINCT
	spouse.tree_id,
	normalized.id,
	spouse.tree_created_at + (spouse.source_ordinal - 1) * interval '1 millisecond',
	GREATEST(
		spouse.tree_updated_at,
		spouse.tree_created_at + (spouse.source_ordinal - 1) * interval '1 millisecond',
		COALESCE(spouse.tree_deleted_at, '-infinity'::timestamp with time zone)
	),
	spouse.tree_deleted_at
FROM "_legacy_spouses" AS spouse
INNER JOIN "_normalization_unions" AS normalized
	ON normalized.first_person_id = spouse.first_person_id
	AND normalized.second_person_id = spouse.second_person_id;
--> statement-breakpoint
INSERT INTO "parent_child_relationships" ("id", "parent_person_id", "child_person_id", "type", "created_at", "updated_at", "deleted_at")
SELECT id, parent_person_id, child_person_id, relationship_type::"parent_child_relationship_type", created_at, updated_at, deleted_at
FROM "_normalization_parent_relationships";
--> statement-breakpoint
INSERT INTO "tree_parent_child_relationships" ("tree_id", "parent_child_relationship_id", "created_at", "updated_at", "deleted_at")
SELECT DISTINCT
	relationship.tree_id,
	normalized.id,
	relationship.tree_created_at + (relationship.source_ordinal - 1) * interval '1 millisecond',
	GREATEST(
		relationship.tree_updated_at,
		relationship.tree_created_at + (relationship.source_ordinal - 1) * interval '1 millisecond',
		COALESCE(relationship.tree_deleted_at, '-infinity'::timestamp with time zone)
	),
	relationship.tree_deleted_at
FROM "_legacy_parent_relationships" AS relationship
INNER JOIN "_normalization_parent_relationships" AS normalized
	ON normalized.parent_person_id = relationship.parent_person_id
	AND normalized.child_person_id = relationship.child_person_id;
--> statement-breakpoint
CREATE TEMP TABLE "_expected_spouses" ON COMMIT DROP AS
SELECT DISTINCT
	spouse.tree_id,
	spouse.first_person_id,
	spouse.second_person_id,
	normalized.event_date,
	spouse.tree_created_at + (spouse.source_ordinal - 1) * interval '1 millisecond' AS association_created_at,
	GREATEST(
		spouse.tree_updated_at,
		spouse.tree_created_at + (spouse.source_ordinal - 1) * interval '1 millisecond',
		COALESCE(spouse.tree_deleted_at, '-infinity'::timestamp with time zone)
	) AS association_updated_at,
	spouse.tree_deleted_at AS association_deleted_at,
	normalized.deleted_at AS fact_deleted_at,
	normalized.deleted_at AS event_deleted_at
FROM "_legacy_spouses" AS spouse
INNER JOIN "_normalization_unions" AS normalized
	ON normalized.first_person_id = spouse.first_person_id
	AND normalized.second_person_id = spouse.second_person_id;
--> statement-breakpoint
CREATE TEMP TABLE "_actual_spouses" ON COMMIT DROP AS
SELECT
	association.tree_id,
	"union".first_person_id,
	"union".second_person_id,
	event.event_date,
	association.created_at AS association_created_at,
	association.updated_at AS association_updated_at,
	association.deleted_at AS association_deleted_at,
	"union".deleted_at AS fact_deleted_at,
	event.deleted_at AS event_deleted_at
FROM "tree_unions" AS association
INNER JOIN "unions" AS "union" ON "union".id = association.union_id
INNER JOIN "union_events" AS event
	ON event.union_id = "union".id
	AND event.type = 'married';
--> statement-breakpoint
CREATE TEMP TABLE "_expected_parent_relationships" ON COMMIT DROP AS
SELECT DISTINCT
	relationship.tree_id,
	relationship.parent_person_id,
	relationship.child_person_id,
	relationship.relationship_type,
	relationship.tree_created_at + (relationship.source_ordinal - 1) * interval '1 millisecond' AS association_created_at,
	GREATEST(
		relationship.tree_updated_at,
		relationship.tree_created_at + (relationship.source_ordinal - 1) * interval '1 millisecond',
		COALESCE(relationship.tree_deleted_at, '-infinity'::timestamp with time zone)
	) AS association_updated_at,
	relationship.tree_deleted_at AS association_deleted_at,
	normalized.deleted_at AS fact_deleted_at
FROM "_legacy_parent_relationships" AS relationship
INNER JOIN "_normalization_parent_relationships" AS normalized
	ON normalized.parent_person_id = relationship.parent_person_id
	AND normalized.child_person_id = relationship.child_person_id;
--> statement-breakpoint
CREATE TEMP TABLE "_actual_parent_relationships" ON COMMIT DROP AS
SELECT
	association.tree_id,
	relationship.parent_person_id,
	relationship.child_person_id,
	relationship.type::text AS relationship_type,
	association.created_at AS association_created_at,
	association.updated_at AS association_updated_at,
	association.deleted_at AS association_deleted_at,
	relationship.deleted_at AS fact_deleted_at
FROM "tree_parent_child_relationships" AS association
INNER JOIN "parent_child_relationships" AS relationship
	ON relationship.id = association.parent_child_relationship_id;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'round_trip_member_mismatch', format('tree=%s person=%s', mismatch.tree_id, mismatch.person_id)
FROM (
	(
		SELECT
			tree_id,
			person_id,
			tree_created_at + (source_ordinal - 1) * interval '1 millisecond' AS created_at,
			GREATEST(
				tree_updated_at,
				tree_created_at + (source_ordinal - 1) * interval '1 millisecond',
				COALESCE(tree_deleted_at, '-infinity'::timestamp with time zone)
			) AS updated_at,
			tree_deleted_at AS deleted_at
		FROM "_legacy_members"
		EXCEPT
		SELECT tree_id, person_id, created_at, updated_at, deleted_at FROM "tree_members"
	)
	UNION ALL
	(
		SELECT tree_id, person_id, created_at, updated_at, deleted_at FROM "tree_members"
		EXCEPT
		SELECT
			tree_id,
			person_id,
			tree_created_at + (source_ordinal - 1) * interval '1 millisecond' AS created_at,
			GREATEST(
				tree_updated_at,
				tree_created_at + (source_ordinal - 1) * interval '1 millisecond',
				COALESCE(tree_deleted_at, '-infinity'::timestamp with time zone)
			) AS updated_at,
			tree_deleted_at AS deleted_at
		FROM "_legacy_members"
	)
) AS mismatch
LIMIT 50;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'round_trip_spouse_mismatch', format(
	'tree=%s people=(%s,%s) date=%s',
	mismatch.tree_id,
	mismatch.first_person_id,
	mismatch.second_person_id,
	COALESCE(mismatch.event_date::text, 'null')
)
FROM (
	(
		SELECT tree_id, first_person_id, second_person_id, event_date, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at, event_deleted_at FROM "_expected_spouses"
		EXCEPT
		SELECT tree_id, first_person_id, second_person_id, event_date, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at, event_deleted_at FROM "_actual_spouses"
	)
	UNION ALL
	(
		SELECT tree_id, first_person_id, second_person_id, event_date, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at, event_deleted_at FROM "_actual_spouses"
		EXCEPT
		SELECT tree_id, first_person_id, second_person_id, event_date, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at, event_deleted_at FROM "_expected_spouses"
	)
) AS mismatch
LIMIT 50;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'round_trip_parent_mismatch', format(
	'tree=%s parent=%s child=%s type=%s',
	mismatch.tree_id,
	mismatch.parent_person_id,
	mismatch.child_person_id,
	mismatch.relationship_type
)
FROM (
	(
		SELECT tree_id, parent_person_id, child_person_id, relationship_type, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at FROM "_expected_parent_relationships"
		EXCEPT
		SELECT tree_id, parent_person_id, child_person_id, relationship_type, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at FROM "_actual_parent_relationships"
	)
	UNION ALL
	(
		SELECT tree_id, parent_person_id, child_person_id, relationship_type, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at FROM "_actual_parent_relationships"
		EXCEPT
		SELECT tree_id, parent_person_id, child_person_id, relationship_type, association_created_at, association_updated_at, association_deleted_at, fact_deleted_at FROM "_expected_parent_relationships"
	)
) AS mismatch
LIMIT 50;
--> statement-breakpoint
INSERT INTO "_normalization_issues" ("code", "details")
SELECT 'union_event_cardinality_mismatch', format('union=%s married_event_count=%s', "union".id, count(event.id))
FROM "unions" AS "union"
LEFT JOIN "union_events" AS event
	ON event.union_id = "union".id
	AND event.type = 'married'
GROUP BY "union".id
HAVING count(event.id) <> 1
UNION ALL
SELECT 'union_event_tombstone_mismatch', format('union=%s event=%s', "union".id, event.id)
FROM "unions" AS "union"
INNER JOIN "union_events" AS event
	ON event.union_id = "union".id
	AND event.type = 'married'
WHERE event.deleted_at IS DISTINCT FROM "union".deleted_at
UNION ALL
SELECT 'tree_union_nonmember_endpoint', format('tree=%s union=%s', association.tree_id, association.union_id)
FROM "tree_unions" AS association
INNER JOIN "unions" AS "union" ON "union".id = association.union_id
LEFT JOIN "tree_members" AS first_member
	ON first_member.tree_id = association.tree_id
	AND first_member.person_id = "union".first_person_id
	AND first_member.deleted_at IS NULL
LEFT JOIN "tree_members" AS second_member
	ON second_member.tree_id = association.tree_id
	AND second_member.person_id = "union".second_person_id
	AND second_member.deleted_at IS NULL
WHERE association.deleted_at IS NULL
	AND (first_member.person_id IS NULL OR second_member.person_id IS NULL)
UNION ALL
SELECT 'tree_parent_nonmember_endpoint', format('tree=%s relationship=%s', association.tree_id, association.parent_child_relationship_id)
FROM "tree_parent_child_relationships" AS association
INNER JOIN "parent_child_relationships" AS relationship
	ON relationship.id = association.parent_child_relationship_id
LEFT JOIN "tree_members" AS parent_member
	ON parent_member.tree_id = association.tree_id
	AND parent_member.person_id = relationship.parent_person_id
	AND parent_member.deleted_at IS NULL
LEFT JOIN "tree_members" AS child_member
	ON child_member.tree_id = association.tree_id
	AND child_member.person_id = relationship.child_person_id
	AND child_member.deleted_at IS NULL
WHERE association.deleted_at IS NULL
	AND (parent_member.person_id IS NULL OR child_member.person_id IS NULL);
--> statement-breakpoint
SELECT pg_temp.abort_family_normalization_if_issues('round-trip validation');
--> statement-breakpoint
DROP TRIGGER IF EXISTS "parent_child_relationships_enforce_active_graph" ON "parent_child_relationships";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "public"."enforce_active_parent_graph_integrity"();
--> statement-breakpoint
CREATE FUNCTION "public"."enforce_active_parent_graph_integrity"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
	active_parent_count bigint;
	creates_cycle boolean;
BEGIN
	-- Serialize all active-graph changes until the surrounding transaction ends.
	PERFORM pg_advisory_xact_lock(7091885217057541735);

	-- Physical deletion also only removes an edge, but participates in ordering.
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;

	-- Tombstoning only removes an active edge and must always remain possible.
	IF NEW.deleted_at IS NOT NULL THEN
		RETURN NEW;
	END IF;

	SELECT count(DISTINCT candidate.parent_person_id)
	INTO active_parent_count
	FROM (
		SELECT relationship.parent_person_id
		FROM public.parent_child_relationships AS relationship
		WHERE relationship.child_person_id = NEW.child_person_id
			AND relationship.deleted_at IS NULL
			AND relationship.id <> NEW.id
		UNION ALL
		SELECT NEW.parent_person_id
	) AS candidate;

	IF active_parent_count > 2 THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = format(
				'Active parent graph mutation rejected: child "%s" would have %s active parents (maximum 2)',
				NEW.child_person_id,
				active_parent_count
			),
			DETAIL = format(
				'Parent relationship "%s" with parent "%s" is active.',
				NEW.id,
				NEW.parent_person_id
			),
			HINT = 'Tombstone an existing active parent-child relationship by setting deleted_at before retrying.';
	END IF;

	WITH RECURSIVE ancestors(person_id) AS (
		SELECT NEW.parent_person_id
		UNION
		SELECT relationship.parent_person_id
		FROM ancestors
		INNER JOIN public.parent_child_relationships AS relationship
			ON relationship.child_person_id = ancestors.person_id
		WHERE relationship.deleted_at IS NULL
			AND relationship.id <> NEW.id
	)
	SELECT EXISTS (
		SELECT 1
		FROM ancestors
		WHERE person_id = NEW.child_person_id
	)
	INTO creates_cycle;

	IF creates_cycle THEN
		RAISE EXCEPTION USING
			ERRCODE = '23514',
			MESSAGE = format(
				'Active parent graph mutation rejected: parent "%s" and child "%s" would create an ancestry cycle',
				NEW.parent_person_id,
				NEW.child_person_id
			),
			DETAIL = format(
				'Child "%s" is already an ancestor of parent "%s" through active relationships.',
				NEW.child_person_id,
				NEW.parent_person_id
			),
			HINT = 'Tombstone or reparent the conflicting active relationship before retrying.';
	END IF;

	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "parent_child_relationships_enforce_active_graph"
AFTER INSERT OR DELETE OR UPDATE OF "parent_person_id", "child_person_id", "deleted_at"
ON "parent_child_relationships"
FOR EACH ROW
EXECUTE FUNCTION "public"."enforce_active_parent_graph_integrity"();
--> statement-breakpoint
CREATE INDEX "parent_child_relationships_parent_child_idx" ON "parent_child_relationships" USING btree ("parent_person_id", "child_person_id");
--> statement-breakpoint
CREATE INDEX "parent_child_relationships_child_parent_idx" ON "parent_child_relationships" USING btree ("child_person_id", "parent_person_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "parent_child_relationships_active_parent_child_unique" ON "parent_child_relationships" USING btree ("parent_person_id", "child_person_id") WHERE "parent_child_relationships"."deleted_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "parent_child_relationships_updated_at_idx" ON "parent_child_relationships" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "tree_members_person_id_tree_id_idx" ON "tree_members" USING btree ("person_id", "tree_id");
--> statement-breakpoint
CREATE INDEX "tree_members_updated_at_idx" ON "tree_members" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "tree_parent_child_relationships_relationship_tree_idx" ON "tree_parent_child_relationships" USING btree ("parent_child_relationship_id", "tree_id");
--> statement-breakpoint
CREATE INDEX "tree_parent_child_relationships_updated_at_idx" ON "tree_parent_child_relationships" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "tree_unions_union_id_tree_id_idx" ON "tree_unions" USING btree ("union_id", "tree_id");
--> statement-breakpoint
CREATE INDEX "tree_unions_updated_at_idx" ON "tree_unions" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "union_events_union_id_event_date_idx" ON "union_events" USING btree ("union_id", "event_date");
--> statement-breakpoint
CREATE INDEX "union_events_updated_at_idx" ON "union_events" USING btree ("updated_at");
--> statement-breakpoint
CREATE INDEX "unions_person_pair_idx" ON "unions" USING btree ("first_person_id", "second_person_id");
--> statement-breakpoint
CREATE INDEX "unions_second_person_id_idx" ON "unions" USING btree ("second_person_id");
--> statement-breakpoint
CREATE INDEX "unions_updated_at_idx" ON "unions" USING btree ("updated_at");
--> statement-breakpoint
ALTER TABLE "trees" DROP COLUMN "edges";
