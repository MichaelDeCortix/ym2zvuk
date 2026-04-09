import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readJsonIfExists(filePath, fallback = null) {
  return fileExists(filePath) ? readJson(filePath) : fallback;
}

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function readTextIfExists(filePath, fallback = "") {
  return fileExists(filePath) ? readText(filePath) : fallback;
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, value, "utf8");
}

export function appendText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, value, "utf8");
}

export function fileExists(filePath) {
  return fs.existsSync(filePath);
}

export function removeDir(dirPath) {
  if (fileExists(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function uniqueBy(items, selector) {
  const seen = new Set();
  return items.filter((item) => {
    const key = selector(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

export function safeJsonParse(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function nowIso() {
  return new Date().toISOString();
}

export function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function retry(fn, { retries = 3, initialDelayMs = 400, shouldRetry = () => true } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !shouldRetry(error, attempt)) {
        throw error;
      }
      await sleep(initialDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}

export function formatList(items) {
  return items.filter(Boolean).join(", ");
}

export function csvEscape(value) {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replaceAll("\"", "\"\"")}"`;
  }
  return stringValue;
}

export function writeCsv(filePath, rows) {
  const text = rows.map((row) => row.map((value) => csvEscape(value)).join(",")).join(os.EOL);
  writeText(filePath, `${text}${os.EOL}`);
}

export function isTruthy(value) {
  return /^(1|true|yes|y)$/i.test(String(value ?? "").trim());
}

export function resolveAbsolute(filePath) {
  return path.resolve(filePath);
}

export function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
