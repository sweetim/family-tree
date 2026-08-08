import { describe, expect, test } from "bun:test"
import { MAX_TREE_MEMBERS, MAX_TREE_RELATED_RECORDS } from "../limits"
import type { TreeUsage } from "./push-state"
import { enforceQuota } from "./push-usage"

const usage = (members: number, relatedRecords: number): TreeUsage => ({
  members,
  relatedRecords,
})
const maps = (entries: Array<[string, TreeUsage]>): Map<string, TreeUsage> =>
  new Map(entries)

describe("enforceQuota", () => {
  test("allows trees that stay within both limits", () => {
    const before = maps([
      ["t1", usage(MAX_TREE_MEMBERS, MAX_TREE_RELATED_RECORDS)],
    ])
    const after = maps([
      ["t1", usage(MAX_TREE_MEMBERS, MAX_TREE_RELATED_RECORDS)],
    ])
    expect(enforceQuota(before, after, ["t1"])).toBeUndefined()
  })

  test("flags a member-count overflow that grew", () => {
    const before = maps([["t1", usage(MAX_TREE_MEMBERS - 1, 0)]])
    const after = maps([["t1", usage(MAX_TREE_MEMBERS + 1, 0)]])
    expect(enforceQuota(before, after, ["t1"])).toEqual({
      treeId: "t1",
      reason: "tree-member-limit",
      maximum: MAX_TREE_MEMBERS,
      current: MAX_TREE_MEMBERS + 1,
    })
  })

  test("flags a related-record overflow that grew", () => {
    const before = maps([["t1", usage(0, MAX_TREE_RELATED_RECORDS - 1)]])
    const after = maps([["t1", usage(0, MAX_TREE_RELATED_RECORDS + 1)]])
    expect(enforceQuota(before, after, ["t1"])).toEqual({
      treeId: "t1",
      reason: "tree-related-record-limit",
      maximum: MAX_TREE_RELATED_RECORDS,
      current: MAX_TREE_RELATED_RECORDS + 1,
    })
  })

  test("treats the limit boundary as allowed (strict greater-than)", () => {
    const before = maps([["t1", usage(0, 0)]])
    const after = maps([
      ["t1", usage(MAX_TREE_MEMBERS, MAX_TREE_RELATED_RECORDS)],
    ])
    expect(enforceQuota(before, after, ["t1"])).toBeUndefined()
  })

  test("does not flag a pre-existing overflow that did not grow", () => {
    // Already over the member limit before the mutation; unchanged after, so the
    // mutation did not cause the overflow and must not be rejected.
    const before = maps([["t1", usage(MAX_TREE_MEMBERS + 5, 0)]])
    const after = maps([["t1", usage(MAX_TREE_MEMBERS + 5, 0)]])
    expect(enforceQuota(before, after, ["t1"])).toBeUndefined()
  })

  test("returns the first violating tree in quotaTreeIds order", () => {
    const before = maps([
      ["t1", usage(0, 0)],
      ["t2", usage(MAX_TREE_MEMBERS - 1, 0)],
      ["t3", usage(0, MAX_TREE_RELATED_RECORDS - 1)],
    ])
    const after = maps([
      ["t1", usage(0, 0)],
      ["t2", usage(MAX_TREE_MEMBERS + 1, 0)],
      ["t3", usage(0, MAX_TREE_RELATED_RECORDS + 1)],
    ])
    // t2 (member violation) precedes t3 (related-record violation) in scope order.
    expect(enforceQuota(before, after, ["t1", "t2", "t3"])).toEqual({
      treeId: "t2",
      reason: "tree-member-limit",
      maximum: MAX_TREE_MEMBERS,
      current: MAX_TREE_MEMBERS + 1,
    })
  })

  test("checks member limit before related-record limit within a tree", () => {
    // Both limits overflow on the same tree; member limit wins by check order.
    const before = maps([
      ["t1", usage(MAX_TREE_MEMBERS - 1, MAX_TREE_RELATED_RECORDS - 1)],
    ])
    const after = maps([
      ["t1", usage(MAX_TREE_MEMBERS + 1, MAX_TREE_RELATED_RECORDS + 1)],
    ])
    expect(enforceQuota(before, after, ["t1"])).toEqual({
      treeId: "t1",
      reason: "tree-member-limit",
      maximum: MAX_TREE_MEMBERS,
      current: MAX_TREE_MEMBERS + 1,
    })
  })

  test("treats a tree missing from usageBefore as starting from zero", () => {
    const before = new Map<string, TreeUsage>()
    const after = maps([["t1", usage(MAX_TREE_MEMBERS + 1, 0)]])
    expect(enforceQuota(before, after, ["t1"])).toEqual({
      treeId: "t1",
      reason: "tree-member-limit",
      maximum: MAX_TREE_MEMBERS,
      current: MAX_TREE_MEMBERS + 1,
    })
  })

  test("falls back to usageBefore when a tree is missing from usageAfter", () => {
    // No growth after the default kicks in -> no violation.
    const before = maps([["t1", usage(5000, 1000)]])
    const after = new Map<string, TreeUsage>()
    expect(enforceQuota(before, after, ["t1"])).toBeUndefined()
  })

  test("ignores overflows on trees outside the quota scope", () => {
    const before = maps([["t1", usage(0, 0)]])
    const after = maps([["t1", usage(MAX_TREE_MEMBERS + 1, 0)]])
    expect(enforceQuota(before, after, [])).toBeUndefined()
  })
})
