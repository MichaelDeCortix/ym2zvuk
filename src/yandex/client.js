import axios from "axios";
import { DEFAULT_YANDEX_BASE_URL, PACKAGE_NAME, PACKAGE_VERSION, YANDEX_NO_PROXY_HOSTS } from "../constants.js";
import { applyNoProxy } from "../no-proxy.js";
import { chunk, retry } from "../utils.js";

export class YandexMusicClient {
  constructor({ token, baseURL = DEFAULT_YANDEX_BASE_URL, timeoutMs = 30000 }) {
    if (!token) {
      throw new Error("Yandex token is required.");
    }
    applyNoProxy(YANDEX_NO_PROXY_HOSTS);
    this.token = token;
    this.uid = null;
    this.client = axios.create({
      baseURL,
      timeout: timeoutMs,
      proxy: false,
      headers: {
        Accept: "application/json",
        Authorization: `OAuth ${token}`,
        "User-Agent": `${PACKAGE_NAME}/${PACKAGE_VERSION}`
      }
    });
  }

  async init() {
    const status = await this.accountStatus();
    this.uid = String(status?.account?.uid ?? "");
    if (!this.uid) {
      throw new Error("Unable to resolve Yandex account uid.");
    }
    return status;
  }

  async accountStatus() {
    const data = await this.get("/account/status");
    return data.result ?? data;
  }

  async usersLikesTracks(userId = this.uid) {
    const data = await this.get(`/users/${userId}/likes/tracks`, {
      "if-modified-since-revision": 0
    });
    return data.result?.library?.tracks ?? data.library?.tracks ?? [];
  }

  async usersPlaylistsList(userId = this.uid) {
    const data = await this.get(`/users/${userId}/playlists/list`);
    return data.result ?? [];
  }

  async usersPlaylist(kind, userId = this.uid) {
    const data = await this.get(`/users/${userId}/playlists/${kind}`);
    return data.result ?? data;
  }

  async tracks(trackIds) {
    const ids = Array.isArray(trackIds) ? trackIds : [trackIds];
    const uniqueIds = Array.from(new Set(ids.map((value) => String(value ?? "").trim()).filter(Boolean)));
    const output = [];
    for (const batch of chunk(uniqueIds, 200)) {
      const data = await this.postForm("/tracks", {
        "track-ids": batch.join(","),
        "with-positions": "true"
      });
      output.push(...(data.result ?? []));
    }
    return output;
  }

  async get(url, params = {}) {
    return retry(async () => {
      try {
        const response = await this.client.get(url, { params });
        return response.data;
      } catch (error) {
        throw new Error(formatAxiosError(error));
      }
    }, {
      retries: 2,
      shouldRetry: (error) => /timeout|temporar|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(String(error.message))
    });
  }

  async postForm(url, bodyObject) {
    return retry(async () => {
      try {
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(bodyObject ?? {})) {
          body.append(key, Array.isArray(value) ? value.join(",") : String(value));
        }
        const response = await this.client.post(url, body.toString(), {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          }
        });
        return response.data;
      } catch (error) {
        throw new Error(formatAxiosError(error));
      }
    }, {
      retries: 2,
      shouldRetry: (error) => /timeout|temporar|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(String(error.message))
    });
  }
}

function formatAxiosError(error) {
  const responseData = error?.response?.data;
  if (responseData?.message || responseData?.error) {
    return `Yandex API error: ${responseData.error ?? "Error"}${responseData.message ? `: ${responseData.message}` : ""}`;
  }
  if (responseData && typeof responseData === "object") {
    return `Yandex API error: ${JSON.stringify(responseData)}`;
  }
  return `Yandex API error: ${error?.message ?? "Unknown error"}`;
}
