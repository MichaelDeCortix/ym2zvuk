import test from "node:test";
import assert from "node:assert/strict";
import { isSystemPlaylist, normalizeYandexTrack } from "../src/yandex/export.js";

test("normalizeYandexTrack maps API shape into migrator shape", () => {
  const track = normalizeYandexTrack({
    id: 123,
    title: "Example",
    version: "Radio Edit",
    artists: [{ name: "Artist 1" }, { name: "Artist 2" }],
    albums: [{ id: 55, title: "Album" }],
    durationMs: 180500,
    isrc: "TEST123"
  });

  assert.deepEqual(track, {
    source_id: "123:55",
    track_id: "123",
    album_id: "55",
    title: "Example",
    version: "Radio Edit",
    artists: ["Artist 1", "Artist 2"],
    album: "Album",
    duration_ms: 180500,
    isrc: "TEST123",
    playlists: []
  });
});

test("isSystemPlaylist excludes liked and generated playlists", () => {
  assert.equal(isSystemPlaylist({ title: "Мне нравится" }), true);
  assert.equal(isSystemPlaylist({ title: "Liked Songs" }), true);
  assert.equal(isSystemPlaylist({ title: "Daily Mix", generated: true }), true);
  assert.equal(isSystemPlaylist({ title: "Road Trip", playlistType: "user" }), false);
});
