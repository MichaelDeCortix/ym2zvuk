import test from "node:test";
import assert from "node:assert/strict";
import { durationSimilarity, normalizeText, stringSimilarity } from "../src/text.js";

test("normalizeText strips feat and version markers", () => {
  assert.equal(
    normalizeText("Track Name (Remastered 2020) feat. Artist"),
    "track name"
  );
});

test("stringSimilarity favors close track names", () => {
  assert.ok(stringSimilarity("Y.M.C.A.", "YMCA") > 0.7);
  assert.ok(stringSimilarity("Paranoid", "Poker Face") < 0.5);
});

test("durationSimilarity stays high for small deltas", () => {
  assert.equal(durationSimilarity(180000, 181000), 1);
  assert.ok(durationSimilarity(180000, 188000) < 1);
});
