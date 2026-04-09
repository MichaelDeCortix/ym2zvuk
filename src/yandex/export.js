import { nowIso, uniqueBy, writeJson } from "../utils.js";
import { YandexMusicClient } from "./client.js";

export async function exportYandexLibrary({ token, runPaths }) {
  const client = new YandexMusicClient({ token });
  const account = await client.init();
  const likesShort = await client.usersLikesTracks();
  const playlistStubs = await client.usersPlaylistsList();

  const likeTrackIds = uniqueBy(
    likesShort.map((item) => String(item?.id ?? item?.trackId ?? "")).filter(Boolean),
    (value) => value
  );
  const likedTracks = await client.tracks(likeTrackIds);
  const likedTracksById = new Map(likedTracks.map((track) => [String(track?.id ?? ""), track]));

  const trackIndex = new Map();
  const likedSourceIds = [];
  const exportedPlaylists = [];

  for (const trackShort of likesShort) {
    const fullTrack = likedTracksById.get(String(trackShort?.id ?? trackShort?.trackId ?? ""));
    if (!fullTrack) {
      continue;
    }
    const normalized = normalizeYandexTrack(fullTrack);
    const merged = mergeTrack(trackIndex, normalized);
    likedSourceIds.push(merged.source_id);
  }

  for (const playlistStub of playlistStubs) {
    if (isSystemPlaylist(playlistStub)) {
      continue;
    }
    const playlist = await client.usersPlaylist(playlistStub.kind);
    const playlistItems = [];
    for (const [position, item] of (playlist?.tracks ?? []).entries()) {
      const track = extractPlaylistTrack(item);
      if (!track) {
        continue;
      }
      const normalized = normalizeYandexTrack(track);
      const merged = mergeTrack(trackIndex, normalized);
      merged.playlists = dedupePlaylistRefs([
        ...(merged.playlists ?? []),
        {
          kind: String(playlist?.kind ?? ""),
          title: playlist?.title ?? "",
          position
        }
      ]);
      playlistItems.push({
        source_id: merged.source_id,
        position
      });
    }
    exportedPlaylists.push({
      kind: String(playlist?.kind ?? ""),
      title: playlist?.title ?? "",
      description: playlist?.description ?? null,
      items: playlistItems
    });
  }

  const library = {
    exported_at: nowIso(),
    account: {
      uid: String(account?.account?.uid ?? ""),
      login: account?.account?.login ?? null
    },
    tracks: Array.from(trackIndex.values()),
    likes: likedSourceIds,
    playlists: exportedPlaylists
  };

  const summary = {
    tracks_total: library.tracks.length,
    likes_total: library.likes.length,
    playlists_total: library.playlists.length,
    playlist_items_total: library.playlists.reduce((total, playlist) => total + playlist.items.length, 0)
  };

  writeJson(runPaths.exportPath, library);
  writeJson(runPaths.exportSummaryPath, summary);

  return {
    library,
    summary
  };
}

export function normalizeYandexTrack(track) {
  const trackId = String(track?.id ?? "");
  const firstAlbum = track?.albums?.[0] ?? null;
  const albumId = firstAlbum?.id !== undefined && firstAlbum?.id !== null ? String(firstAlbum.id) : null;
  const sourceId = albumId ? `${trackId}:${albumId}` : trackId;
  return {
    source_id: sourceId,
    track_id: trackId,
    album_id: albumId,
    title: track?.title ?? "",
    version: track?.version ?? null,
    artists: (track?.artists ?? [])
      .map((artist) => artist?.name ?? artist?.title ?? "")
      .filter(Boolean),
    album: firstAlbum?.title ?? null,
    duration_ms: track?.durationMs ?? track?.duration_ms ?? null,
    isrc: track?.isrc ?? null,
    playlists: []
  };
}

export function extractPlaylistTrack(item) {
  return item?.track ?? null;
}

export function mergeTrack(index, track) {
  const existing = index.get(track.source_id);
  if (!existing) {
    index.set(track.source_id, track);
    return track;
  }
  existing.playlists = dedupePlaylistRefs([...(existing.playlists ?? []), ...(track.playlists ?? [])]);
  if (!existing.isrc && track.isrc) {
    existing.isrc = track.isrc;
  }
  return existing;
}

export function dedupePlaylistRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    const key = `${ref?.kind ?? ""}:${ref?.position ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function isSystemPlaylist(playlist) {
  const title = String(playlist?.title ?? "").trim().toLowerCase();
  if (title === "мне нравится" || title === "liked" || title === "liked songs") {
    return true;
  }
  if (playlist?.generated) {
    return true;
  }
  const playlistType = String(playlist?.playlistType ?? playlist?.playlist_type ?? "").trim().toLowerCase();
  return playlistType === "system" || playlistType === "generated";
}
