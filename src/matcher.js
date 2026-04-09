import { durationSimilarity, normalizeText, stringSimilarity, tokenSimilarity } from "./text.js";
import { uniqueBy } from "./utils.js";
import { searchTracks } from "./zvuk/search.js";

export function buildSearchQueries(track) {
  const artist = track.artists?.[0] ?? "";
  const album = track.album ?? "";
  return uniqueBy([
    [track.title, artist].filter(Boolean).join(" "),
    [track.title, track.artists?.slice(0, 2).join(" ")].filter(Boolean).join(" "),
    track.title,
    [track.title, album].filter(Boolean).join(" ")
  ].filter(Boolean), (value) => normalizeText(value));
}

export function scoreCandidate(sourceTrack, candidate) {
  const sourceArtists = sourceTrack.artists ?? [];
  const candidateArtists = candidate.artists?.map((artist) => artist.title) ?? [];
  const titleScore = Math.max(
    stringSimilarity(sourceTrack.title, candidate.title),
    stringSimilarity([sourceTrack.title, sourceTrack.version].filter(Boolean).join(" "), candidate.title)
  );
  const artistScore = sourceArtists.length === 0 || candidateArtists.length === 0
    ? 0
    : averagePairScore(sourceArtists, candidateArtists);
  const durationScore = durationSimilarity(sourceTrack.duration_ms, (candidate.duration ?? 0) * 1000);
  const albumScore = sourceTrack.album && candidate.release?.title
    ? tokenSimilarity(sourceTrack.album, candidate.release.title)
    : 0;
  const score = (titleScore * 0.55) + (artistScore * 0.25) + (durationScore * 0.15) + (albumScore * 0.05);
  const exact = titleScore >= 0.99 && artistScore >= 0.94 && durationScore >= 0.92;
  return {
    score: Number(score.toFixed(4)),
    exact
  };
}

function averagePairScore(leftItems, rightItems) {
  const leftNormalized = leftItems.map((item) => normalizeText(item)).filter(Boolean);
  const rightNormalized = rightItems.map((item) => normalizeText(item)).filter(Boolean);
  if (leftNormalized.length === 0 || rightNormalized.length === 0) {
    return 0;
  }
  let total = 0;
  for (const left of leftNormalized) {
    total += Math.max(...rightNormalized.map((right) => stringSimilarity(left, right)));
  }
  return total / leftNormalized.length;
}

export async function findBestTrackMatch(session, track, { perQueryLimit = 7, fuzzyThreshold = 0.82 } = {}) {
  const candidateMap = new Map();
  for (const query of buildSearchQueries(track)) {
    const items = await searchTracks(session, query, perQueryLimit);
    for (const item of items) {
      const existing = candidateMap.get(item.id);
      if (existing) {
        existing.queries.push(query);
      } else {
        candidateMap.set(item.id, { candidate: item, queries: [query] });
      }
    }
  }
  const scored = Array.from(candidateMap.values())
    .map((entry) => ({
      ...entry,
      ...scoreCandidate(track, entry.candidate)
    }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0] ?? null;
  const status = !best
    ? "missing"
    : best.exact
      ? "exact"
      : best.score >= fuzzyThreshold
        ? "fuzzy"
        : "ambiguous";
  return { status, best, candidates: scored.slice(0, 10) };
}
