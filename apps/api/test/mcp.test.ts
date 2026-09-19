import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { logArgs, searchArgs, TOOLS } from "../src/routes/mcp.ts";
import { generateToken, hashToken, tokenHint } from "../src/lib/tokens.ts";

describe("agent tokens", () => {
  it("issues a recognisable, unique token each time", () => {
    const tokens = new Set(Array.from({ length: 50 }, generateToken));
    assert.equal(tokens.size, 50);
    for (const t of tokens) {
      assert.match(t, /^eats_[A-Za-z0-9_-]{43}$/);
    }
  });

  it("hashes deterministically, so a presented token can be looked up", () => {
    const token = generateToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.notEqual(hashToken(token), hashToken(generateToken()));
  });

  it("never lets the raw token survive hashing", () => {
    const token = generateToken();
    assert.ok(!hashToken(token).includes(token.slice(5)));
  });

  it("shows enough of a token to recognise it and no more", () => {
    const token = "eats_abcdefghijklmnop";
    const hint = tokenHint(token);
    assert.ok(token.endsWith(hint.slice(-4)));
    assert.ok(hint.length < token.length);
  });
});

describe("mcp tool arguments", () => {
  it("accepts logging an existing food by id", () => {
    const parsed = logArgs.safeParse({
      foodId: "550e8400-e29b-41d4-a716-446655440000",
      grams: 60,
      meal: "breakfast",
    });
    assert.ok(parsed.success);
  });

  it("accepts a food not in the database when macros come with it", () => {
    const parsed = logArgs.safeParse({
      name: "Kanelbulle från fiket",
      grams: 85,
      meal: "snack",
      kcal100g: 380,
      protein100g: 7,
      carbs100g: 52,
      fat100g: 15,
    });
    assert.ok(parsed.success);
  });

  it("rejects a meal the app does not have", () => {
    assert.ok(!logArgs.safeParse({ grams: 60, meal: "brunch" }).success);
  });

  it("rejects portions that would poison the day total", () => {
    // An agent misreading kg as g is the realistic failure here.
    for (const grams of [0, -60, 9000]) {
      assert.ok(
        !logArgs.safeParse({ grams, meal: "lunch" }).success,
        `${grams} g should be rejected`,
      );
    }
  });

  it("rejects macros outside what food can physically be", () => {
    const base = { name: "Impossible", grams: 100, meal: "lunch" };
    assert.ok(!logArgs.safeParse({ ...base, kcal100g: 5000 }).success);
    assert.ok(!logArgs.safeParse({ ...base, fat100g: 150 }).success);
    assert.ok(!logArgs.safeParse({ ...base, protein100g: -1 }).success);
  });

  it("requires something to search for", () => {
    assert.ok(!searchArgs.safeParse({ query: "" }).success);
    assert.ok(searchArgs.safeParse({ query: "havregryn" }).success);
  });
});

describe("mcp tool declarations", () => {
  it("describes every tool well enough for an agent to use it unprompted", () => {
    assert.deepEqual(
      TOOLS.map((t) => t.name),
      ["search_foods", "log_food", "get_today"],
    );
    for (const tool of TOOLS) {
      assert.ok(
        tool.description.length > 80,
        `${tool.name} needs a real description`,
      );
      assert.equal(tool.inputSchema.type, "object");
      for (const [field, schema] of Object.entries(
        tool.inputSchema.properties,
      )) {
        assert.ok(
          (schema as { description?: string }).description,
          `${tool.name}.${field} needs a description`,
        );
      }
    }
  });

  it("only demands the arguments that have no sensible default", () => {
    const required = Object.fromEntries(
      TOOLS.map((t) => [
        t.name,
        (t.inputSchema as { required?: readonly string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(required.search_foods, ["query"]);
    // Neither foodId nor name is required: one or the other is checked at
    // call time, which a JSON Schema `required` list cannot express.
    assert.deepEqual(required.log_food, ["grams", "meal"]);
    // Defaults to today, which is the whole point of the tool.
    assert.deepEqual(required.get_today, []);
  });
});
