#!/usr/bin/env node
import readline from "node:readline/promises";
import { ensureOverridesFile, loadConfig, resolveConfiguredToken, saveConfig } from "./config.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./constants.js";
import { runImport, runMatch, runMigrate, runVerify } from "./importer.js";
import { runInit } from "./init.js";
import { getAppPaths, ensureAppDirs } from "./paths.js";
import { runProbe } from "./probe.js";
import { removeDir, formatError, nowIso, parseArgs } from "./utils.js";
import { exportYandexLibrary } from "./yandex/export.js";
import { resolveRunPaths, updateRunManifest } from "./run-state.js";

const args = parseArgs(process.argv.slice(2));
const command = normalizeCommand(args._[0] ?? "");

if (!command) {
  printUsage();
  process.exit(1);
}

const paths = getAppPaths({ stateDir: args["state-dir"] });
ensureAppDirs(paths);
ensureOverridesFile(paths);
const config = loadConfig(paths);

try {
  switch (command) {
    case "init":
      await handleInit();
      break;
    case "export":
      await handleExport();
      break;
    case "probe":
      await handleProbe();
      break;
    case "match":
      process.exitCode = (await handleMatch()).exitCode;
      break;
    case "import":
      process.exitCode = (await handleImport()).exitCode;
      break;
    case "verify":
      process.exitCode = (await handleVerify()).exitCode;
      break;
    case "migrate":
      process.exitCode = (await handleMigrate()).exitCode;
      break;
    case "reset":
      await handleReset();
      break;
    case "help":
      printUsage();
      break;
    case "version":
      console.log(`${PACKAGE_NAME} ${PACKAGE_VERSION}`);
      break;
    default:
      printUsage();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}

async function handleInit() {
  const result = await runInit({ args, paths, config });
  console.log(`Config saved: ${paths.configPath}`);
  console.log(`Overrides CSV: ${paths.overridesPath}`);
  console.log(`Probe templates: ${result.templatesPath}`);
}

async function handleExport() {
  const token = requireToken("yandexToken", "YANDEX_MUSIC_TOKEN", "Yandex");
  const runPaths = resolveRunPaths({ paths, config, args, createIfMissing: true, suffix: "export" });
  const { summary } = await exportYandexLibrary({
    token,
    runPaths
  });
  saveConfig(paths, {
    ...config,
    yandexToken: token,
    lastRunDir: runPaths.dir
  });
  updateRunManifest(runPaths, {
    createdAt: nowIso(),
    lastCommand: "export",
    exportPath: runPaths.exportPath,
    exportSummaryPath: runPaths.exportSummaryPath,
    commandHistory: [{
      command: "export",
      at: nowIso()
    }]
  });
  console.log(`Run dir: ${runPaths.dir}`);
  console.log(`Library exported: ${runPaths.exportPath}`);
  console.log(`Summary exported: ${runPaths.exportSummaryPath}`);
  console.log(`Counts: tracks=${summary.tracks_total}, likes=${summary.likes_total}, playlists=${summary.playlists_total}, playlist_items=${summary.playlist_items_total}`);
}

async function handleProbe() {
  const result = await runProbe({ paths });
  console.log(`Probe capture: ${paths.probeCapturePath}`);
  console.log(`Probe templates: ${paths.templatesPath}`);
  console.log(`Captured actions: ${Object.keys(result.templates.actions).join(", ")}`);
}

async function handleMatch() {
  const token = requireToken("zvukToken", "ZVUK_TOKEN", "Zvuk");
  saveConfig(paths, {
    ...config,
    zvukToken: token
  });
  return runMatch({ args, paths, config: loadConfig(paths), token });
}

async function handleImport() {
  const token = requireToken("zvukToken", "ZVUK_TOKEN", "Zvuk");
  saveConfig(paths, {
    ...config,
    zvukToken: token
  });
  const result = await runImport({ args, paths, config: loadConfig(paths), token });
  console.log(`Match report: ${result.runPaths.matchReportPath}`);
  console.log(`Migration report: ${result.runPaths.migrationReportPath}`);
  console.log(`Checkpoint: ${result.runPaths.checkpointPath}`);
  return result;
}

async function handleVerify() {
  const token = requireToken("zvukToken", "ZVUK_TOKEN", "Zvuk");
  saveConfig(paths, {
    ...config,
    zvukToken: token
  });
  const result = await runVerify({ args, paths, config: loadConfig(paths), token });
  console.log(`Verification report: ${result.runPaths.verifyReportPath}`);
  return result;
}

async function handleMigrate() {
  const yandexToken = requireToken("yandexToken", "YANDEX_MUSIC_TOKEN", "Yandex");
  const zvukToken = requireToken("zvukToken", "ZVUK_TOKEN", "Zvuk");
  saveConfig(paths, {
    ...config,
    yandexToken,
    zvukToken
  });
  const result = await runMigrate({
    args,
    paths,
    config: loadConfig(paths),
    exportFn: exportYandexLibrary,
    yandexToken,
    zvukToken,
    saveConfigFn: saveConfig
  });
  console.log(`Run dir: ${result.runPaths.dir}`);
  console.log(`Export: ${result.runPaths.exportPath}`);
  console.log(`Match report: ${result.runPaths.matchReportPath}`);
  console.log(`Migration report: ${result.runPaths.migrationReportPath}`);
  console.log(`Verification report: ${result.runPaths.verifyReportPath}`);
  return result;
}

async function handleReset() {
  if (!args.force) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    try {
      const answer = await rl.question(`Delete ${paths.root}? [y/N]: `);
      if (!/^(y|yes)$/i.test(answer.trim())) {
        console.log("Reset cancelled.");
        return;
      }
    } finally {
      rl.close();
    }
  }
  removeDir(paths.root);
  console.log(`Removed state directory: ${paths.root}`);
}

function requireToken(configKey, envName, label) {
  const token = resolveConfiguredToken(args, config, configKey, envName);
  if (!token) {
    throw new Error(`${label} token is required. Provide --${configKey === "yandexToken" ? "yandex-token" : "zvuk-token"} or run init.`);
  }
  return token;
}

function normalizeCommand(value) {
  const command = String(value ?? "").trim().toLowerCase();
  if (command === "probe-zvuk") {
    return "probe";
  }
  if (command === "dry-run-match") {
    return "match";
  }
  return command;
}

function printUsage() {
  console.error(`Usage:
  ym2zvuk init [--state-dir <dir>] [--yandex-token <token>] [--zvuk-token <token>] [--skip-probe] [--templates <file>]
  ym2zvuk export [--state-dir <dir>] [--run-dir <dir>] [--yandex-token <token>]
  ym2zvuk probe [--state-dir <dir>]
  ym2zvuk match [--state-dir <dir>] [--run-dir <dir>] [--input <export.json>] [--zvuk-token <token>] [--limit <n>] [--report-format console|json|csv|all]
  ym2zvuk import [--state-dir <dir>] [--run-dir <dir>] [--input <export.json>] [--zvuk-token <token>] [--templates <file>] [--retry-failed]
  ym2zvuk verify [--state-dir <dir>] [--run-dir <dir>] [--input <export.json>] [--zvuk-token <token>]
  ym2zvuk migrate [--state-dir <dir>] [--run-dir <dir>] [--yandex-token <token>] [--zvuk-token <token>] [--templates <file>] [--retry-failed]
  ym2zvuk reset [--state-dir <dir>] [--force]
  ym2zvuk version

Compatibility aliases:
  ym2zvuk probe-zvuk
  ym2zvuk dry-run-match`);
}
