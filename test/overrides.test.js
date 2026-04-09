import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadOverrides, parseCsvLine } from "../src/overrides.js";

test("parseCsvLine handles quoted commas and quotes", () => {
  assert.deepEqual(
    parseCsvLine("\"source,1\",\"track\"\"42\",force_match,\"manual, confirmed\""),
    ["source,1", "track\"42", "force_match", "manual, confirmed"]
  );
});

test("loadOverrides normalizes actions and ids", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ym2zvuk-overrides-"));
  const filePath = path.join(tempDir, "overrides.csv");
  fs.writeFileSync(filePath, [
    "source_id,zvuk_track_id,action,comment",
    "a:1,42,force_match,Confirmed",
    "b:2,,,Skip by default when no id",
    ""
  ].join("\n"));

  const overrides = loadOverrides(filePath);
  assert.equal(overrides.get("a:1").action, "force_match");
  assert.equal(overrides.get("a:1").zvuk_track_id, "42");
  assert.equal(overrides.get("b:2").action, "skip");
  assert.equal(overrides.get("b:2").zvuk_track_id, null);
});
