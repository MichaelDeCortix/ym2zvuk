import path from "node:path";
import readline from "node:readline/promises";
import { chromium } from "playwright";
import { PLAYLIST_PROBE_SENTINEL, REQUIRED_TEMPLATE_ACTIONS } from "./constants.js";
import { ensureDir, nowIso, safeJsonParse, writeJson } from "./utils.js";

export async function runProbe({ paths }) {
  ensureDir(path.dirname(paths.probeCapturePath));
  ensureDir(paths.playwrightUserDataDir);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const context = await chromium.launchPersistentContext(paths.playwrightUserDataDir, {
    headless: false
  });

  try {
    const page = context.pages()[0] ?? await context.newPage();
    const records = [];

    context.on("response", async (response) => {
      const request = response.request();
      const url = request.url();
      if (!url.includes("zvuk.com/api/")) {
        return;
      }
      const method = request.method().toUpperCase();
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        return;
      }
      let requestHeaders = {};
      let responseHeaders = {};
      let responseBody = null;
      try {
        requestHeaders = await request.allHeaders();
        responseHeaders = await response.allHeaders();
        responseBody = await response.text();
      } catch {
        responseBody = null;
      }
      records.push({
        capturedAt: nowIso(),
        method,
        url,
        requestHeaders,
        responseHeaders,
        requestBody: request.postData() ?? null,
        responseStatus: response.status(),
        responseBody
      });
    });

    console.log("1. Авторизуйтесь в Звуке в открывшемся браузере.");
    console.log("2. Поставьте лайк любому треку, которого сейчас нет в избранном.");
    console.log(`3. Создайте плейлист с именем ${PLAYLIST_PROBE_SENTINEL}.`);
    console.log("4. Добавьте тот же трек в этот плейлист.");
    console.log("");

    await page.goto("https://zvuk.com", { waitUntil: "domcontentloaded" });
    await rl.question("Нажмите Enter после логина...");

    const likeStart = records.length;
    await rl.question("Поставьте лайк треку и нажмите Enter...");
    const likeRecords = records.slice(likeStart);

    const createStart = records.length;
    await rl.question(`Создайте плейлист ${PLAYLIST_PROBE_SENTINEL} и нажмите Enter...`);
    const createRecords = records.slice(createStart);

    const addStart = records.length;
    await rl.question("Добавьте тот же трек в плейлист и нажмите Enter...");
    const addRecords = records.slice(addStart);

    const capture = {
      createdAt: nowIso(),
      playlistSentinel: PLAYLIST_PROBE_SENTINEL,
      likeRecords,
      createRecords,
      addRecords
    };

    const templates = extractTemplates(capture);
    validateProbeTemplates(templates);

    writeJson(paths.probeCapturePath, capture);
    writeJson(paths.templatesPath, templates);

    return { capture, templates };
  } finally {
    rl.close();
    await context.close();
  }
}

export function validateProbeTemplates(templates) {
  for (const action of REQUIRED_TEMPLATE_ACTIONS) {
    if (!templates?.actions?.[action]) {
      throw new Error(`Probe templates are incomplete. Missing action: ${action}`);
    }
  }
  return true;
}

function extractTemplates(capture) {
  const likeRecord = selectBestRecord(capture.likeRecords, { expectMutation: true });
  const createRecord = selectBestRecord(capture.createRecords, { expectMutation: true, contains: PLAYLIST_PROBE_SENTINEL });
  const addRecord = selectBestRecord(capture.addRecords, { expectMutation: true });

  const likePayload = parsePayload(likeRecord?.requestBody);
  const createPayload = parsePayload(createRecord?.requestBody);
  const createResponse = parsePayload(createRecord?.responseBody);
  const addPayload = parsePayload(addRecord?.requestBody);

  const trackProbeValue = inferTrackProbeValue(likePayload, addPayload);
  const playlistIdProbeValue = inferPlaylistIdProbeValue(createPayload, createResponse, addPayload, trackProbeValue);

  return {
    createdAt: nowIso(),
    playlistSentinel: PLAYLIST_PROBE_SENTINEL,
    inferred: {
      trackProbeValue,
      playlistIdProbeValue,
      playlistIdResponsePath: firstPathByValue(createResponse, playlistIdProbeValue)
    },
    actions: {
      like_track: buildRequestTemplate(likeRecord, {
        trackProbeValue
      }),
      create_playlist: buildRequestTemplate(createRecord, {
        playlistSentinel: PLAYLIST_PROBE_SENTINEL
      }),
      add_track_to_playlist: buildRequestTemplate(addRecord, {
        trackProbeValue,
        playlistIdProbeValue,
        playlistSentinel: PLAYLIST_PROBE_SENTINEL
      })
    }
  };
}

function selectBestRecord(records, { expectMutation = false, contains = null } = {}) {
  return records
    .map((record) => ({
      record,
      score: scoreRecord(record, { expectMutation, contains })
    }))
    .sort((left, right) => right.score - left.score)[0]?.record ?? null;
}

function scoreRecord(record, { expectMutation, contains }) {
  let score = 0;
  if (!record) {
    return score;
  }
  if (record.url.includes("/graphql")) {
    score += 40;
  }
  if (expectMutation && String(record.requestBody ?? "").toLowerCase().includes("mutation")) {
    score += 35;
  }
  if (contains && `${record.requestBody ?? ""}\n${record.responseBody ?? ""}`.includes(contains)) {
    score += 30;
  }
  if (record.responseStatus >= 200 && record.responseStatus < 300) {
    score += 15;
  }
  if (/playlist|like|favorite|library/i.test(`${record.url}\n${record.requestBody ?? ""}`)) {
    score += 10;
  }
  return score;
}

function parsePayload(value) {
  return safeJsonParse(value) ?? value;
}

function inferTrackProbeValue(likePayload, addPayload) {
  const addValueSet = new Set(primitiveEntries(addPayload).map((entry) => serializeValue(entry.value)));
  return primitiveEntries(likePayload)
    .filter((entry) => addValueSet.has(serializeValue(entry.value)))
    .find((entry) => /track|media|content|id/i.test(entry.path))
    ?.value ?? null;
}

function inferPlaylistIdProbeValue(createPayload, createResponse, addPayload, trackProbeValue) {
  const addValueSet = new Set(primitiveEntries(addPayload).map((entry) => serializeValue(entry.value)));
  return [...primitiveEntries(createPayload), ...primitiveEntries(createResponse)]
    .filter((entry) => addValueSet.has(serializeValue(entry.value)))
    .filter((entry) => entry.value !== PLAYLIST_PROBE_SENTINEL && entry.value !== trackProbeValue)
    .find((entry) => /playlist|collection|id/i.test(entry.path))
    ?.value ?? null;
}

function buildRequestTemplate(record, replacements) {
  if (!record) {
    return null;
  }
  const requestBody = parsePayload(record.requestBody);
  const responseBody = parsePayload(record.responseBody);
  return {
    method: record.method,
    url: applyReplacementMap(record.url, replacements),
    headers: sanitizeHeaders(record.requestHeaders),
    body: typeof requestBody === "string" ? applyReplacementMap(requestBody, replacements) : replaceDeep(requestBody, replacements),
    responseBodyPathHints: {
      playlistIdPath: firstPathByValue(responseBody, replacements.playlistIdProbeValue)
    }
  };
}

function sanitizeHeaders(headers) {
  const allowList = ["accept", "content-type", "origin", "referer", "x-requested-with", "x-user-auth"];
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(([key]) => allowList.includes(key.toLowerCase()))
  );
}

function replaceDeep(value, replacements) {
  if (Array.isArray(value)) {
    return value.map((entry) => replaceDeep(entry, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceDeep(entry, replacements)]));
  }
  return applyReplacementMap(value, replacements);
}

function applyReplacementMap(value, replacements) {
  if (typeof value !== "string" && typeof value !== "number") {
    return value;
  }
  let output = String(value);
  if (replacements.trackProbeValue !== undefined && replacements.trackProbeValue !== null) {
    output = output.split(String(replacements.trackProbeValue)).join("__TRACK_ID__");
  }
  if (replacements.playlistIdProbeValue !== undefined && replacements.playlistIdProbeValue !== null) {
    output = output.split(String(replacements.playlistIdProbeValue)).join("__PLAYLIST_ID__");
  }
  if (replacements.playlistSentinel) {
    output = output.split(String(replacements.playlistSentinel)).join("__PLAYLIST_NAME__");
  }
  if (typeof value === "number" && /^__.+__$/.test(output)) {
    return output;
  }
  return output;
}

function primitiveEntries(value, currentPath = "$") {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value !== "object") {
    return [{ path: currentPath, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => primitiveEntries(entry, `${currentPath}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) => primitiveEntries(entry, `${currentPath}.${key}`));
}

function firstPathByValue(value, wanted) {
  if (wanted === null || wanted === undefined) {
    return null;
  }
  return primitiveEntries(value).find((entry) => serializeValue(entry.value) === serializeValue(wanted))?.path ?? null;
}

function serializeValue(value) {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
