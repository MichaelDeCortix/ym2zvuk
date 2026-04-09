export const SEARCH_ALL_QUERY = `
query getSearchAll(
  $query: String
  $limit: Int = 5
  $trackCursor: Cursor = null
) {
  search(query: $query) {
    searchId
    tracks(limit: $limit, cursor: $trackCursor) {
      page {
        total
        prev
        next
        cursor
      }
      score
      items {
        id
        title
        availability
        explicit
        artistTemplate
        artists {
          id
          title
        }
        zchan
        condition
        duration
        release {
          id
          title
          image {
            src
          }
        }
      }
    }
  }
}`;

export async function searchTracks(session, query, limit = 5) {
  const response = await session.graphql("getSearchAll", SEARCH_ALL_QUERY, {
    query,
    limit,
    trackCursor: null
  });
  return response?.data?.search?.tracks?.items ?? [];
}
