const COLLECTION_IDS_QUERY = `
query getCollectionIds {
  collection {
    tracks {
      id
    }
  }
}`;

const PAGINATED_COLLECTION_QUERY = `
query getPaginatedCollection($limit: Int = 30, $after: String = null) {
  paginatedCollection {
    tracks(pagination: { first: $limit, after: $after }) {
      items {
        id
        title
        artists {
          title
        }
      }
      page {
        endCursor
      }
    }
  }
}`;

const USER_PLAYLISTS_QUERY = `
query getProfilesShortPlaylistsInfo($limit: Int = 30, $offset: String = null) {
  getUserPlaylists {
    paginated(pagination: { first: $limit, after: $offset }) {
      playlists {
        id
        title
      }
      page {
        endCursor
        hasNextPage
      }
    }
  }
}`;

const PLAYLIST_TRACKS_QUERY = `
query getPlaylistTracks($id: ID!, $limit: Int = 100, $offset: Int = 0) {
  playlistTracks(id: $id, limit: $limit, offset: $offset) {
    id
    title
    artists {
      title
    }
  }
}`;

export async function getCollectionTrackIds(session) {
  const response = await session.graphql("getCollectionIds", COLLECTION_IDS_QUERY);
  return new Set((response?.data?.collection?.tracks ?? []).map((item) => String(item.id)));
}

export async function getCollectionTracks(session, limit = 100) {
  const items = [];
  const seenCursors = new Set();
  let cursor = null;
  while (true) {
    const response = await session.graphql("getPaginatedCollection", PAGINATED_COLLECTION_QUERY, {
      limit,
      after: cursor
    });
    const trackPage = response?.data?.paginatedCollection?.tracks;
    const pageItems = trackPage?.items ?? [];
    items.push(...pageItems);
    const nextCursor = trackPage?.page?.endCursor ?? null;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  return items;
}

export async function getUserPlaylists(session, limit = 30) {
  const playlists = [];
  const seenCursors = new Set();
  let offset = null;
  while (true) {
    const response = await session.graphql("getProfilesShortPlaylistsInfo", USER_PLAYLISTS_QUERY, {
      limit,
      offset
    });
    const page = response?.data?.getUserPlaylists?.paginated;
    playlists.push(...(page?.playlists ?? []));
    const nextCursor = page?.page?.endCursor ?? null;
    const hasNextPage = Boolean(page?.page?.hasNextPage);
    if (!hasNextPage || !nextCursor || seenCursors.has(nextCursor)) {
      break;
    }
    seenCursors.add(nextCursor);
    offset = nextCursor;
  }
  return playlists;
}

export async function getPlaylistTracks(session, playlistId, limit = 100) {
  const tracks = [];
  let offset = 0;
  while (true) {
    const response = await session.graphql("getPlaylistTracks", PLAYLIST_TRACKS_QUERY, {
      id: String(playlistId),
      limit,
      offset
    });
    const batch = response?.data?.playlistTracks ?? [];
    tracks.push(...batch);
    if (batch.length < limit) {
      break;
    }
    offset += batch.length;
  }
  return tracks;
}
