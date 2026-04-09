import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { saveConfig } from "./config.js";
import { buildNoProxyEnv } from "./no-proxy.js";
import { runProbe, validateProbeTemplates } from "./probe.js";
import { ensureDir, fileExists, readJson, writeJson } from "./utils.js";

const require = createRequire(import.meta.url);

export async function runInit({ args, paths, config }) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    const yandexToken = await promptSecret(rl, "Yandex token", args["yandex-token"], config.yandexToken);
    const zvukToken = await promptSecret(rl, "Zvuk token", args["zvuk-token"], config.zvukToken);

    saveConfig(paths, {
      ...config,
      yandexToken,
      zvukToken
    });

    if (args.templates) {
      const templateSource = path.resolve(args.templates);
      if (!fileExists(templateSource)) {
        throw new Error(`Template file not found: ${templateSource}`);
      }
      ensureDir(path.dirname(paths.templatesPath));
      writeJson(paths.templatesPath, readJson(templateSource));
    }

    if (!args["skip-probe"] && !args["no-probe"]) {
      await ensureChromiumInstalled();
      await runProbe({ paths });
    }

    if (!fileExists(paths.templatesPath)) {
      throw new Error(`Missing ${paths.templatesPath}. Run init without --skip-probe or provide --templates.`);
    }
    validateProbeTemplates(readJson(paths.templatesPath));

    return {
      yandexTokenSaved: Boolean(yandexToken),
      zvukTokenSaved: Boolean(zvukToken),
      templatesPath: paths.templatesPath
    };
  } finally {
    rl.close();
  }
}

async function promptSecret(rl, label, explicitValue, currentValue) {
  const explicit = String(explicitValue ?? "").trim();
  if (explicit) {
    return explicit;
  }
  if (currentValue) {
    const answer = await rl.question(`${label} [Enter to keep current]: `);
    return answer.trim() || currentValue;
  }
  const answer = await rl.question(`${label}: `);
  if (!answer.trim()) {
    throw new Error(`${label} is required.`);
  }
  return answer.trim();
}

async function ensureChromiumInstalled() {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return;
  } catch {
    const cliPath = require.resolve("playwright/cli.js");
    await runNodeCommand(cliPath, ["install", "chromium"]);
  }
}

function runNodeCommand(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: "inherit",
      env: buildNoProxyEnv([], process.env)
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed with exit code ${code}`));
    });
  });
}
