import path from "node:path";
import { createRunPaths, getRunPaths } from "./paths.js";
import { fileExists, nowIso, readJsonIfExists, writeJson } from "./utils.js";

export function resolveRunPaths({ paths, config, args, createIfMissing = false, suffix = "" }) {
  if (args["run-dir"]) {
    return getRunPaths(paths, args["run-dir"]);
  }
  if (args.input) {
    return getRunPaths(paths, path.dirname(path.resolve(args.input)));
  }
  if (createIfMissing) {
    return createRunPaths(paths, { suffix });
  }
  if (config.lastRunDir) {
    return getRunPaths(paths, config.lastRunDir);
  }
  throw new Error("Run directory is not specified and no previous run is recorded. Use --run-dir or run export/migrate first.");
}

export function updateRunManifest(runPaths, patch) {
  const manifest = readJsonIfExists(runPaths.manifestPath, {
    createdAt: nowIso(),
    commandHistory: []
  });
  const nextManifest = {
    ...manifest,
    ...patch,
    updatedAt: nowIso(),
    commandHistory: [
      ...(manifest.commandHistory ?? []),
      ...(patch.commandHistory ?? [])
    ]
  };
  writeJson(runPaths.manifestPath, nextManifest);
  return nextManifest;
}

export function hasRunExport(runPaths) {
  return fileExists(runPaths.exportPath);
}
