import { describe, expect, test } from "bun:test";
import {
  ancestorsOf,
  childrenOf,
  emptyEdges,
  focusFamily,
  projectTree,
  type ParentLink,
  type PersonIdentity,
} from "./types";

describe("projectTree", () => {
  test("merges identity with per-tree spouse and parent edges", () => {
    const tim: PersonIdentity = { id: "tim", name: "Tim" };
    const yumi: PersonIdentity = { id: "yumi", name: "Yumi" };
    const kid: PersonIdentity = { id: "kid", name: "Kid A" };
    const identities = { tim, yumi, kid };
    const edges = {
      members: ["tim", "yumi", "kid"],
      spouses: [["tim", "yumi"]] as [string, string][],
      parents: { kid: [{ id: "tim" }, { id: "yumi" }] },
    };

    const family = projectTree(identities, edges);

    expect(family.tim!.spouseIds).toEqual(["yumi"]);
    expect(family.yumi!.spouseIds).toEqual(["tim"]);
    expect(family.kid!.parents.map(l => l.id)).toEqual(["tim", "yumi"]);
    expect(family.tim!.parents).toEqual([]);
  });

  test("ignores members whose identity is missing", () => {
    const family = projectTree({ a: { id: "a", name: "A" } }, {
      members: ["a", "ghost"],
      spouses: [],
      parents: {},
    });
    expect(Object.keys(family)).toEqual(["a"]);
  });

  test("a person with no edges still projects", () => {
    const family = projectTree({ a: { id: "a", name: "A" } }, emptyEdges());
    expect(family).toEqual({});
  });
});

describe("relationship traversal (on projected data)", () => {
  const identities: Record<string, PersonIdentity> = {
    gp: { id: "gp", name: "Grandpa" },
    dad: { id: "dad", name: "Dad" },
    kid: { id: "kid", name: "Kid" },
  };
  const parents: Record<string, ParentLink[]> = { dad: [{ id: "gp" }], kid: [{ id: "dad" }] };
  const family = projectTree(identities, {
    members: ["gp", "dad", "kid"],
    spouses: [],
    parents,
  });

  test("childrenOf / ancestorsOf / focusFamily", () => {
    expect(childrenOf(family, "gp").map(p => p.id)).toEqual(["dad"]);
    expect(ancestorsOf(family, "kid")).toEqual(new Set(["dad", "gp"]));
    expect(Object.keys(focusFamily(family, "kid")).sort()).toEqual(["dad", "gp", "kid"]);
  });
});