import { fileExists, readText, writeCsv, writeText } from "./utils.js";

export function ensureOverridesCsv(filePath) {
  if (!fileExists(filePath)) {
    writeText(filePath, "source_id,zvuk_track_id,action,comment\n");
  }
}

export function loadOverrides(filePath) {
  ensureOverridesCsv(filePath);
  const lines = readText(filePath).split(/\r?\n/);
  const output = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (index === 0 && line.toLowerCase().startsWith("source_id,")) {
      continue;
    }
    const [sourceId = "", zvukTrackId = "", action = "", comment = ""] = parseCsvLine(lines[index]);
    if (!sourceId.trim()) {
      continue;
    }
    const normalizedAction = String(action || (zvukTrackId ? "force_match" : "skip")).trim().toLowerCase();
    output.set(sourceId.trim(), {
      source_id: sourceId.trim(),
      zvuk_track_id: zvukTrackId.trim() || null,
      action: normalizedAction,
      comment: comment.trim() || null
    });
  }
  return output;
}

export function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

export function writeUnmatchedCsv(filePath, matches) {
  const rows = [
    ["source_id", "title", "artists", "status", "best_zvuk_track_id", "best_title", "best_artists", "best_score"]
  ];
  for (const match of matches) {
    rows.push([
      match.source_id,
      match.title,
      (match.artists ?? []).join(" | "),
      match.status,
      match.best?.id ?? "",
      match.best?.title ?? "",
      (match.best?.artists ?? []).join(" | "),
      match.best?.score ?? ""
    ]);
  }
  writeCsv(filePath, rows);
}
