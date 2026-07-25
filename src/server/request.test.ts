import { describe, expect, test } from "bun:test"
import { readJsonBody } from "./request"

describe("bounded JSON requests", () => {
  test("parses JSON within the byte limit", async () => {
    const result = await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ value: "ok" }),
      }),
      100,
    )
    expect(result).toEqual({ ok: true, value: { value: "ok" } })
  })

  test("rejects declared and actual oversized bodies", async () => {
    const declared = await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        headers: { "content-length": "101" },
        body: "{}",
      }),
      100,
    )
    expect(declared).toEqual({ ok: false, error: "too-large" })

    const actual = await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        body: JSON.stringify({ value: "too large" }),
      }),
      5,
    )
    expect(actual).toEqual({ ok: false, error: "too-large" })
  })

  test("rejects malformed JSON", async () => {
    const result = await readJsonBody(
      new Request("https://example.test", { method: "POST", body: "{" }),
      100,
    )
    expect(result).toEqual({ ok: false, error: "invalid-json" })
  })
})
