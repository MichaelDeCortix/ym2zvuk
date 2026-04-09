import os from "node:os";
import path from "node:path";
import { GLOBAL_FILE_NAMES, RUN_FILE_NAMES } from "./constants.js";
import { compactTimestamp, ensureDir } from "./utils.js";

export function getDefaultStateRoot() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "ym2zvuk");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "ym2zvuk");
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "ym2zvuk");
}

export function resolveStateRoot(explicitRoot) {
  return path.resolve(explicitRoot ?? process.env.YM2ZVUK_HOME ?? getDefaultStateRoot());
}

export function getAppPaths(options = {}) {
  const root = resolveStateRoot(options.stateDir);
  return {
    root,
    configPath: path.join(root, GLOBAL_FILE_NAMES.config),
    overridesPath: path.join(root, GLOBAL_FILE_NAMES.overrides),
    templatesPath: path.join(root, GLOBAL_FILE_NAMES.templates),
    probeCapturePath: path.join(root, GLOBAL_FILE_NAMES.probeCapture),
    playwrightUserDataDir: path.join(root, "playwright", "zvuk"),
    runsDir: path.join(root, "runs")
  };
}

export function ensureAppDirs(paths) {
  ensureDir(paths.root);
  ensureDir(paths.runsDir);
  ensureDir(path.dirname(paths.configPath));
}

export function getRunPaths(paths, runDir) {
  const dir = path.resolve(runDir);
  return {
    dir,
    manifestPath: path.join(dir, RUN_FILE_NAMES.manifest),
    exportPath: path.join(dir, RUN_FILE_NAMES.export),
    exportSummaryPath: path.join(dir, RUN_FILE_NAMES.exportSummary),
    matchReportPath: path.join(dir, RUN_FILE_NAMES.matchReport),
    unmatchedCsvPath: path.join(dir, RUN_FILE_NAMES.unmatchedCsv),
    migrationReportPath: path.join(dir, RUN_FILE_NAMES.migrationReport),
    migrationMarkdownPath: path.join(dir, RUN_FILE_NAMES.migrationMarkdown),
    checkpointPath: path.join(dir, RUN_FILE_NAMES.checkpoint),
    verifyReportPath: path.join(dir, RUN_FILE_NAMES.verifyReport)
  };
}

export function createRunPaths(paths, { runId = compactTimestamp(), suffix = "" } = {}) {
  const directoryName = suffix ? `${runId}-${suffix}` : runId;
  const runPaths = getRunPaths(paths, path.join(paths.runsDir, directoryName));
  ensureDir(runPaths.dir);
  return runPaths;
}
