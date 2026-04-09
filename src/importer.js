import path from "node:path";
import { DEFAULT_MATCH_OPTIONS, REPORT_FORMATS } from "./constants.js";
import { findBestTrackMatch } from "./matcher.js";
import { loadOverrides, writeUnmatchedCsv } from "./overrides.js";
import { validateProbeTemplates } from "./probe.js";
import { hasRunExport, resolveRunPaths, updateRunManifest } from "./run-state.js";
import { averageStringListSimilarity, normalizeText, stringSimilarity } from "./text-verify.js";
import { getCollectionTrackIds, getCollectionTracks, getPlaylistTracks, getUserPlaylists } from "./zvuk/library.js";
import { ZvukSession } from "./zvuk/session.js";
import {
  ensureDir,
  fileExists,
  nowIso,
  readJson,
  readJsonIfExists,
  writeJson,
  writeText
} from "./utils.js";

export async function runMatch({ args, paths, config, token }) {
  const runPaths = resolveRunPaths({ paths, config, args, createIfMissing: false });
  const library = loadLibrary(runPaths, args);
  const overrides = loadOverrides(paths.overridesPath);
  const session = new ZvukSession({ token });
  const profile = await session.prime();
  const tracks = sliceTracksByLimit(library.tracks, args.limit);
  const report = await buildMatchReport({
    session,
    tracks,
    overrides,
    profile,
    runPaths,
    libraryTrackTotal: library.tracks.length
  });
  emitMatchOutputs(runPaths, report, normalizeReportFormat(args["report-format"]));
  updateRunManifest(runPaths, {
    lastCommand: "match",
    matchReportPath: runPaths.matchReportPath,
    commandHistory: [{
      command: "match",
      at: nowIso()
    }]
  });
  return {
    runPaths,
    report,
    exitCode: 0
  };
}

export async function runImport({ args, paths, config, token }) {
  const runPaths = resolveRunPaths({ paths, config, args, createIfMissing: false });
  const library = loadLibrary(runPaths, args);
  const overrides = loadOverrides(paths.overridesPath);
  const templatePath = path.resolve(args.templates ?? paths.templatesPath);
  if (!fileExists(templatePath)) {
    throw new Error(`Zvuk write templates not found: ${templatePath}`);
  }
  const templates = readJson(templatePath);
  validateProbeTemplates(templates);

  const session = new ZvukSession({ token });
  const profile = await session.prime();

  const matchReport = await buildMatchReport({ session, tracks: library.tracks, overrides, profile, runPaths });
  emitMatchOutputs(runPaths, matchReport, normalizeReportFormat("json"));
  const matchIndex = new Map(matchReport.matches.map((match) => [match.source_id, match]));

  const checkpoint = loadCheckpoint(runPaths);
  const remoteLikedIds = await getCollectionTrackIds(session);
  const remotePlaylists = await getUserPlaylists(session);
  const playlistByTitle = buildPlaylistTitleMap(remotePlaylists);
  const playlistTrackCache = new Map();
  const retryFailed = Boolean(args["retry-failed"]);

  for (const sourceId of library.likes) {
    const previous = checkpoint.likes[sourceId];
    if (isFinalItemState(previous?.status, retryFailed)) {
      continue;
    }
    const match = matchIndex.get(sourceId);
    if (!isResolvedMatch(match)) {
      checkpoint.likes[sourceId] = buildSkippedItemState(sourceId, match);
      saveCheckpoint(runPaths, checkpoint);
      continue;
    }
    const targetTrackId = String(match.best.id);
    if (remoteLikedIds.has(targetTrackId)) {
      checkpoint.likes[sourceId] = {
        source_id: sourceId,
        zvuk_track_id: targetTrackId,
        status: "duplicate"
      };
      saveCheckpoint(runPaths, checkpoint);
      continue;
    }
    try {
      await replayTemplate(session, templates.actions.like_track, {
        trackId: targetTrackId
      });
      remoteLikedIds.add(targetTrackId);
      checkpoint.likes[sourceId] = {
        source_id: sourceId,
        zvuk_track_id: targetTrackId,
        status: "imported"
      };
    } catch (error) {
      checkpoint.likes[sourceId] = {
        source_id: sourceId,
        zvuk_track_id: targetTrackId,
        status: isDuplicateError(error) ? "duplicate" : "failed",
        error: error.message
      };
    }
    saveCheckpoint(runPaths, checkpoint);
  }

  for (const playlist of library.playlists) {
    const playlistState = checkpoint.playlists[playlist.kind] ?? {
      kind: playlist.kind,
      title: playlist.title,
      status: "pending",
      items: {}
    };
    checkpoint.playlists[playlist.kind] = playlistState;

    if (!playlistState.zvuk_playlist_id) {
      const existingPlaylist = playlistByTitle.get(playlist.title);
      if (existingPlaylist) {
        playlistState.zvuk_playlist_id = String(existingPlaylist.id);
        playlistState.status = "reused";
      } else {
        try {
          const createResponse = await replayTemplate(session, templates.actions.create_playlist, {
            playlistName: playlist.title
          });
          playlistState.zvuk_playlist_id = String(
            extractPath(
              createResponse,
              templates.actions.create_playlist?.responseBodyPathHints?.playlistIdPath
                ?? templates.inferred?.playlistIdResponsePath
            ) ?? ""
          );
          playlistState.status = "created";
          playlistByTitle.set(playlist.title, { id: playlistState.zvuk_playlist_id, title: playlist.title });
        } catch (error) {
          playlistState.status = "create-failed";
          playlistState.error = error.message;
          saveCheckpoint(runPaths, checkpoint);
          continue;
        }
      }
      saveCheckpoint(runPaths, checkpoint);
    }

    const currentTrackIds = await getOrLoadPlaylistTrackIds(session, playlistTrackCache, playlistState.zvuk_playlist_id);
    for (const item of playlist.items) {
      const previous = playlistState.items[item.source_id];
      if (isFinalItemState(previous?.status, retryFailed)) {
        continue;
      }
      const match = matchIndex.get(item.source_id);
      if (!isResolvedMatch(match)) {
        playlistState.items[item.source_id] = buildSkippedItemState(item.source_id, match);
        saveCheckpoint(runPaths, checkpoint);
        continue;
      }
      const targetTrackId = String(match.best.id);
      if (currentTrackIds.has(targetTrackId)) {
        playlistState.items[item.source_id] = {
          source_id: item.source_id,
          zvuk_track_id: targetTrackId,
          status: "duplicate"
        };
        saveCheckpoint(runPaths, checkpoint);
        continue;
      }
      try {
        await replayTemplate(session, templates.actions.add_track_to_playlist, {
          trackId: targetTrackId,
          playlistId: playlistState.zvuk_playlist_id
        });
        currentTrackIds.add(targetTrackId);
        playlistState.items[item.source_id] = {
          source_id: item.source_id,
          zvuk_track_id: targetTrackId,
          status: "imported"
        };
      } catch (error) {
        playlistState.items[item.source_id] = {
          source_id: item.source_id,
          zvuk_track_id: targetTrackId,
          status: isDuplicateError(error) ? "duplicate" : "failed",
          error: error.message
        };
      }
      saveCheckpoint(runPaths, checkpoint);
    }
  }

  const report = buildMigrationReport({ library, checkpoint, matchReport, profile });
  writeJson(runPaths.migrationReportPath, report);
  writeText(runPaths.migrationMarkdownPath, renderMigrationMarkdown(report));
  updateRunManifest(runPaths, {
    lastCommand: "import",
    migrationReportPath: runPaths.migrationReportPath,
    checkpointPath: runPaths.checkpointPath,
    commandHistory: [{
      command: "import",
      at: nowIso()
    }]
  });
  return {
    runPaths,
    report,
    exitCode: report.unmatched > 0 || report.liked.failed > 0 || report.playlists.failed > 0 ? 2 : 0
  };
}

export async function runVerify({ args, paths, config, token }) {
  const runPaths = resolveRunPaths({ paths, config, args, createIfMissing: false });
  const library = loadLibrary(runPaths, args);
  const overrides = loadOverrides(paths.overridesPath);
  const session = new ZvukSession({ token });
  const profile = await session.prime();

  const existingMatchReport = fileExists(runPaths.matchReportPath) ? readJson(runPaths.matchReportPath) : null;
  const matchReport = isCompleteMatchReport(existingMatchReport, library)
    ? existingMatchReport
    : (await buildMatchReport({
      session,
      tracks: library.tracks,
      overrides,
      profile,
      runPaths,
      libraryTrackTotal: library.tracks.length
    }));
  if (!existingMatchReport || !isCompleteMatchReport(existingMatchReport, library)) {
    emitMatchOutputs(runPaths, matchReport, normalizeReportFormat("json"));
  }

  const matchIndex = new Map(matchReport.matches.map((match) => [match.source_id, match]));
  const trackIndex = new Map(library.tracks.map((track) => [track.source_id, track]));
  const importReport = readJsonIfExists(runPaths.migrationReportPath, null);

  const collectionIds = await getCollectionTrackIds(session);
  const collectionTracks = await getCollectionTracks(session);
  const userPlaylists = await getUserPlaylists(session);
  const playlistsByTitle = buildPlaylistTitleMap(userPlaylists);
  const playlistIdHints = new Map(
    (importReport?.playlists?.details ?? [])
      .filter((detail) => detail?.source_kind && detail?.zvuk_playlist_id)
      .map((detail) => [detail.source_kind, detail.zvuk_playlist_id])
  );

  const likesReport = {
    expected: 0,
    verified_by_id: 0,
    verified_by_fallback: 0,
    missing: []
  };

  for (const sourceId of library.likes) {
    const match = matchIndex.get(sourceId);
    if (!isResolvedMatch(match)) {
      continue;
    }
    likesReport.expected += 1;
    const targetTrackId = String(match.best.id);
    if (collectionIds.has(targetTrackId)) {
      likesReport.verified_by_id += 1;
      continue;
    }
    const sourceTrack = trackIndex.get(sourceId);
    const fallbackTrack = collectionTracks.find((candidate) => isSemanticTrackMatch(sourceTrack, candidate));
    if (fallbackTrack) {
      likesReport.verified_by_fallback += 1;
      continue;
    }
    likesReport.missing.push({
      source_id: sourceId,
      expected_zvuk_track_id: targetTrackId,
      title: sourceTrack?.title ?? "",
      artists: sourceTrack?.artists ?? []
    });
  }

  const playlistsReport = {
    expected: library.playlists.length,
    verified: 0,
    missing_playlists: [],
    track_gaps: []
  };

  for (const playlist of library.playlists) {
    const hintedId = playlistIdHints.get(playlist.kind);
    const remotePlaylist = hintedId
      ? userPlaylists.find((entry) => String(entry.id) === String(hintedId))
      : playlistsByTitle.get(playlist.title);
    if (!remotePlaylist) {
      playlistsReport.missing_playlists.push({
        kind: playlist.kind,
        title: playlist.title
      });
      continue;
    }
    const remoteTracks = await getPlaylistTracks(session, remotePlaylist.id);
    const remoteTrackIds = new Set(remoteTracks.map((track) => String(track.id)));
    const missingTracks = [];
    const expectedTrackIds = new Set();

    for (const item of playlist.items) {
      const match = matchIndex.get(item.source_id);
      if (!isResolvedMatch(match)) {
        continue;
      }
      const targetTrackId = String(match.best.id);
      if (expectedTrackIds.has(targetTrackId)) {
        continue;
      }
      expectedTrackIds.add(targetTrackId);
      if (remoteTrackIds.has(targetTrackId)) {
        continue;
      }
      const sourceTrack = trackIndex.get(item.source_id);
      const fallbackTrack = remoteTracks.find((candidate) => isSemanticTrackMatch(sourceTrack, candidate));
      if (!fallbackTrack) {
        missingTracks.push({
          source_id: item.source_id,
          expected_zvuk_track_id: targetTrackId,
          title: sourceTrack?.title ?? "",
          artists: sourceTrack?.artists ?? []
        });
      }
    }

    if (missingTracks.length === 0) {
      playlistsReport.verified += 1;
    } else {
      playlistsReport.track_gaps.push({
        kind: playlist.kind,
        title: playlist.title,
        zvuk_playlist_id: String(remotePlaylist.id),
        missing_tracks: missingTracks,
        expected_unique_tracks: expectedTrackIds.size,
        actual_tracks: remoteTracks.length
      });
    }
  }

  const report = {
    createdAt: nowIso(),
    zvukProfile: {
      id: profile?.id ?? null,
      name: profile?.name ?? null,
      email: profile?.email ?? null
    },
    likes: likesReport,
    playlists: playlistsReport,
    ok: likesReport.missing.length === 0 && playlistsReport.missing_playlists.length === 0 && playlistsReport.track_gaps.length === 0
  };

  writeJson(runPaths.verifyReportPath, report);
  updateRunManifest(runPaths, {
    lastCommand: "verify",
    verifyReportPath: runPaths.verifyReportPath,
    commandHistory: [{
      command: "verify",
      at: nowIso()
    }]
  });
  return {
    runPaths,
    report,
    exitCode: report.ok ? 0 : 2
  };
}

export async function runMigrate({ args, paths, config, exportFn, yandexToken, zvukToken, saveConfigFn }) {
  const runPaths = resolveRunPaths({ paths, config, args, createIfMissing: true, suffix: "migrate" });
  saveConfigFn(paths, {
    ...config,
    lastRunDir: runPaths.dir
  });

  await exportFn({
    token: yandexToken,
    runPaths
  });

  const matchResult = await runMatch({
    args: {
      ...args,
      input: runPaths.exportPath
    },
    paths,
    config: {
      ...config,
      lastRunDir: runPaths.dir
    },
    token: zvukToken
  });

  const importResult = await runImport({
    args: {
      ...args,
      input: runPaths.exportPath
    },
    paths,
    config: {
      ...config,
      lastRunDir: runPaths.dir
    },
    token: zvukToken
  });

  const verifyResult = await runVerify({
    args: {
      ...args,
      input: runPaths.exportPath
    },
    paths,
    config: {
      ...config,
      lastRunDir: runPaths.dir
    },
    token: zvukToken
  });

  return {
    runPaths,
    matchReport: matchResult.report,
    importReport: importResult.report,
    verifyReport: verifyResult.report,
    exitCode: Math.max(matchResult.exitCode, importResult.exitCode, verifyResult.exitCode)
  };
}

async function buildMatchReport({ session, tracks, overrides, profile, runPaths, libraryTrackTotal }) {
  const matches = [];
  for (const track of tracks) {
    const override = overrides.get(track.source_id);
    if (override?.action === "skip") {
      matches.push({
        source_id: track.source_id,
        title: track.title,
        artists: track.artists,
        duration_ms: track.duration_ms,
        status: "skipped",
        override_action: "skip",
        best: null,
        candidates: []
      });
      continue;
    }
    if (override?.action === "force_match") {
      if (!override.zvuk_track_id) {
        throw new Error(`Override for ${track.source_id} uses force_match without zvuk_track_id.`);
      }
      matches.push({
        source_id: track.source_id,
        title: track.title,
        artists: track.artists,
        duration_ms: track.duration_ms,
        status: "override",
        override_action: "force_match",
        best: {
          id: String(override.zvuk_track_id),
          title: null,
          artists: [],
          release: null,
          duration: null,
          score: 1,
          exact: false,
          forced: true
        },
        candidates: []
      });
      continue;
    }
    const result = await findBestTrackMatch(session, track, DEFAULT_MATCH_OPTIONS);
    matches.push({
      source_id: track.source_id,
      title: track.title,
      artists: track.artists,
      duration_ms: track.duration_ms,
      status: result.status,
      best: result.best ? summarizeBest(result.best) : null,
      candidates: result.candidates.slice(0, 5).map((entry) => summarizeCandidate(entry))
    });
  }
  return {
    createdAt: nowIso(),
    runDir: runPaths.dir,
    libraryTrackTotal,
    matchedTrackTotal: tracks.length,
    limited: tracks.length !== libraryTrackTotal,
    zvukProfile: profile ? {
      id: profile.id,
      name: profile.name,
      email: profile.email
    } : null,
    totals: summarizeMatchTotals(matches),
    matches
  };
}

function emitMatchOutputs(runPaths, report, reportFormat) {
  writeJson(runPaths.matchReportPath, report);
  const unresolved = getUnresolvedMatches(report.matches);
  if (reportFormat === "csv" || reportFormat === "all" || unresolved.length >= 10) {
    writeUnmatchedCsv(runPaths.unmatchedCsvPath, unresolved);
  }
  if (reportFormat === "console" || reportFormat === "all") {
    printMatchSummary(report, unresolved, runPaths);
  }
}

function isCompleteMatchReport(report, library) {
  return Boolean(report && report.matchedTrackTotal === library.tracks.length && report.matches?.length === library.tracks.length);
}

function printMatchSummary(report, unresolved, runPaths) {
  console.log(`Match report saved: ${runPaths.matchReportPath}`);
  if (fileExists(runPaths.unmatchedCsvPath)) {
    console.log(`Unmatched CSV: ${runPaths.unmatchedCsvPath}`);
  }
  console.log(
    `Matches: total=${report.totals.total}, exact=${report.totals.exact}, fuzzy=${report.totals.fuzzy}, override=${report.totals.override}, ambiguous=${report.totals.ambiguous}, missing=${report.totals.missing}, skipped=${report.totals.skipped}`
  );
  if (unresolved.length > 0 && unresolved.length < 10) {
    for (const item of unresolved) {
      console.log(`- ${item.status}: ${item.title} / ${(item.artists ?? []).join(", ")} (${item.source_id})`);
    }
  }
}

function normalizeReportFormat(value) {
  const normalized = String(value ?? "all").toLowerCase();
  if (!REPORT_FORMATS.has(normalized)) {
    throw new Error(`Unsupported report format: ${value}`);
  }
  return normalized;
}

function loadLibrary(runPaths, args) {
  const inputPath = path.resolve(args.input ?? runPaths.exportPath);
  if (!fileExists(inputPath)) {
    if (!hasRunExport(runPaths)) {
      throw new Error(`Export file not found: ${inputPath}`);
    }
    throw new Error(`Input library not found: ${inputPath}`);
  }
  return readJson(inputPath);
}

function loadCheckpoint(runPaths) {
  return readJsonIfExists(runPaths.checkpointPath, {
    createdAt: nowIso(),
    updatedAt: nowIso(),
    likes: {},
    playlists: {}
  });
}

function saveCheckpoint(runPaths, checkpoint) {
  checkpoint.updatedAt = nowIso();
  writeJson(runPaths.checkpointPath, checkpoint);
}

function buildMigrationReport({ library, checkpoint, matchReport, profile }) {
  const likedDetails = library.likes.map((sourceId) => ({
    source_id: sourceId,
    ...(checkpoint.likes[sourceId] ?? { status: "pending" })
  }));
  const playlistDetails = library.playlists.map((playlist) => {
    const state = checkpoint.playlists[playlist.kind] ?? { items: {}, status: "pending" };
    const itemDetails = playlist.items.map((item) => ({
      source_id: item.source_id,
      position: item.position,
      ...(state.items?.[item.source_id] ?? { status: "pending" })
    }));
    return {
      source_kind: playlist.kind,
      source_title: playlist.title,
      status: state.status,
      zvuk_playlist_id: state.zvuk_playlist_id ?? null,
      imported: itemDetails.filter((item) => item.status === "imported").length,
      skipped: itemDetails.filter((item) => item.status === "duplicate" || item.status === "missing-match" || item.status === "skipped-override").length,
      failed: itemDetails.filter((item) => item.status === "failed").length,
      details: itemDetails
    };
  });

  return {
    createdAt: nowIso(),
    zvukProfile: {
      id: profile?.id ?? null,
      name: profile?.name ?? null,
      email: profile?.email ?? null
    },
    liked: {
      imported: likedDetails.filter((item) => item.status === "imported").length,
      skipped: likedDetails.filter((item) => item.status === "duplicate" || item.status === "missing-match" || item.status === "skipped-override").length,
      failed: likedDetails.filter((item) => item.status === "failed").length,
      details: likedDetails
    },
    playlists: {
      created: playlistDetails.filter((item) => item.status === "created").length,
      reused: playlistDetails.filter((item) => item.status === "reused").length,
      failed: playlistDetails.filter((item) => item.status === "create-failed" || item.failed > 0).length,
      details: playlistDetails
    },
    unmatched: getUnresolvedMatches(matchReport.matches).length
  };
}

function renderMigrationMarkdown(report) {
  return [
    "# ym2zvuk migration report",
    "",
    `Created: ${report.createdAt}`,
    "",
    "## Likes",
    `- imported: ${report.liked.imported}`,
    `- skipped: ${report.liked.skipped}`,
    `- failed: ${report.liked.failed}`,
    "",
    "## Playlists",
    `- created: ${report.playlists.created}`,
    `- reused: ${report.playlists.reused}`,
    `- failed: ${report.playlists.failed}`,
    "",
    "## Match gaps",
    `- unresolved: ${report.unmatched}`
  ].join("\n");
}

function buildPlaylistTitleMap(playlists) {
  const map = new Map();
  for (const playlist of playlists) {
    if (!map.has(playlist.title)) {
      map.set(playlist.title, playlist);
    }
  }
  return map;
}

async function getOrLoadPlaylistTrackIds(session, cache, playlistId) {
  const cacheKey = String(playlistId);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }
  const tracks = await getPlaylistTracks(session, playlistId);
  const trackIds = new Set(tracks.map((track) => String(track.id)));
  cache.set(cacheKey, trackIds);
  return trackIds;
}

function isFinalItemState(status, retryFailed) {
  if (!status) {
    return false;
  }
  if (status === "failed") {
    return !retryFailed;
  }
  return true;
}

function buildSkippedItemState(sourceId, match) {
  if (match?.status === "skipped") {
    return {
      source_id: sourceId,
      status: "skipped-override"
    };
  }
  return {
    source_id: sourceId,
    status: "missing-match"
  };
}

function isResolvedMatch(match) {
  return Boolean(match?.best && ["exact", "fuzzy", "override"].includes(match.status));
}

function getUnresolvedMatches(matches) {
  return matches.filter((match) => ["ambiguous", "missing"].includes(match.status));
}

async function replayTemplate(session, template, variables) {
  if (!template) {
    throw new Error("Missing probe template for action.");
  }
  return session.request({
    method: template.method,
    url: replacePlaceholders(template.url, variables),
    headers: replacePlaceholders(template.headers, variables),
    data: replacePlaceholders(template.body, variables)
  });
}

function replacePlaceholders(value, variables) {
  if (Array.isArray(value)) {
    return value.map((entry) => replacePlaceholders(entry, variables));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replacePlaceholders(entry, variables)]));
  }
  if (typeof value !== "string") {
    return value;
  }
  return value
    .replaceAll("__TRACK_ID__", String(variables.trackId ?? "__TRACK_ID__"))
    .replaceAll("__PLAYLIST_ID__", String(variables.playlistId ?? "__PLAYLIST_ID__"))
    .replaceAll("__PLAYLIST_NAME__", String(variables.playlistName ?? "__PLAYLIST_NAME__"));
}

function extractPath(value, pathExpression) {
  if (!pathExpression) {
    return null;
  }
  const segments = pathExpression
    .replace(/^\$\./, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let current = value;
  for (const segment of segments) {
    if (current === undefined || current === null) {
      return null;
    }
    current = current[segment];
  }
  return current ?? null;
}

function summarizeBest(best) {
  return {
    id: best.candidate.id,
    title: best.candidate.title,
    artists: best.candidate.artists?.map((artist) => artist.title) ?? [],
    release: best.candidate.release?.title ?? null,
    duration: best.candidate.duration,
    score: best.score,
    exact: best.exact
  };
}

function summarizeCandidate(candidate) {
  return {
    id: candidate.candidate.id,
    title: candidate.candidate.title,
    artists: candidate.candidate.artists?.map((artist) => artist.title) ?? [],
    release: candidate.candidate.release?.title ?? null,
    duration: candidate.candidate.duration,
    score: candidate.score,
    exact: candidate.exact
  };
}

function summarizeMatchTotals(matches) {
  const totals = {
    exact: 0,
    fuzzy: 0,
    override: 0,
    ambiguous: 0,
    missing: 0,
    skipped: 0
  };
  for (const match of matches) {
    totals[match.status] = (totals[match.status] ?? 0) + 1;
  }
  totals.total = matches.length;
  return totals;
}

function isDuplicateError(error) {
  return /(exist|already|duplicate|дублик|уже)/i.test(String(error?.message ?? ""));
}

function sliceTracksByLimit(tracks, limitValue) {
  const limit = Number(limitValue ?? 0);
  return Number.isFinite(limit) && limit > 0 ? tracks.slice(0, limit) : tracks;
}

function isSemanticTrackMatch(sourceTrack, candidateTrack) {
  if (!sourceTrack || !candidateTrack) {
    return false;
  }
  const sourceTitle = [sourceTrack.title, sourceTrack.version].filter(Boolean).join(" ");
  const titleScore = Math.max(
    stringSimilarity(sourceTrack.title, candidateTrack.title),
    stringSimilarity(sourceTitle, candidateTrack.title)
  );
  const artistScore = averageStringListSimilarity(
    sourceTrack.artists ?? [],
    (candidateTrack.artists ?? []).map((artist) => artist.title ?? artist)
  );
  return titleScore >= 0.92 && artistScore >= 0.8;
}
