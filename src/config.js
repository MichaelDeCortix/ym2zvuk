import path from "node:path";
import { ensureDir, fileExists, nowIso, readJson, writeJson, writeText } from "./utils.js";

const DEFAULT_CONFIG = {
  version: 1,
  createdAt: null,
  updatedAt: null,
  yandexToken: "",
  zvukToken: "",
  lastRunDir: ""
};

export function loadConfig(paths) {
  if (!fileExists(paths.configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  return {
    ...DEFAULT_CONFIG,
    ...readJson(paths.configPath)
  };
}

export function saveConfig(paths, config) {
  ensureDir(path.dirname(paths.configPath));
  const existing = loadConfig(paths);
  const createdAt = existing.createdAt ?? config.createdAt ?? nowIso();
  writeJson(paths.configPath, {
    ...DEFAULT_CONFIG,
    ...existing,
    ...config,
    createdAt,
    updatedAt: nowIso()
  });
}

export function ensureOverridesFile(paths) {
  if (!fileExists(paths.overridesPath)) {
    writeText(paths.overridesPath, "source_id,zvuk_track_id,action,comment\n");
  }
}

export function resolveConfiguredToken(args, config, key, envName) {
  return String(args[key] ?? process.env[envName] ?? config[key] ?? "").trim();
}
