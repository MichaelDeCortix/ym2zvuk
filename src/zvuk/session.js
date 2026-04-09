import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { DEFAULT_ZVUK_BASE_URL, ZVUK_NO_PROXY_HOSTS } from "../constants.js";
import { applyNoProxy } from "../no-proxy.js";
import { retry } from "../utils.js";

export class ZvukSession {
  constructor({ token, timeoutMs = 30000 }) {
    if (!token) {
      throw new Error("Zvuk token is required.");
    }
    applyNoProxy(ZVUK_NO_PROXY_HOSTS);
    this.token = token;
    this.jar = new CookieJar();
    this.client = wrapper(axios.create({
      baseURL: DEFAULT_ZVUK_BASE_URL,
      timeout: timeoutMs,
      proxy: false,
      maxRedirects: 10,
      withCredentials: true,
      jar: this.jar,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        "X-Auth-Token": token
      }
    }));
  }

  async prime() {
    const response = await this.client.get("/api/tiny/profile");
    return response.data?.result ?? response.data;
  }

  async graphql(operationName, query, variables = {}) {
    return this.request({
      method: "POST",
      url: "/api/v1/graphql",
      data: {
        operationName,
        variables,
        query
      }
    }, "Zvuk GraphQL");
  }

  async request(config, prefix = "Zvuk API") {
    return retry(async () => {
      try {
        const response = await this.client.request(config);
        if (typeof response.data === "string" && /<!doctype html>|<html/i.test(response.data)) {
          throw new Error(`${prefix} temporary HTML response`);
        }
        if (response.data?.errors?.length) {
          throw new Error(`${prefix} error: ${response.data.errors.map((entry) => entry.message).join("; ")}`);
        }
        return response.data;
      } catch (error) {
        throw new Error(formatAxiosError(error, prefix));
      }
    }, {
      retries: 3,
      initialDelayMs: 500,
      shouldRetry: (error) => isRetryableError(error)
    });
  }
}

function isRetryableError(error) {
  return /timeout|temporar|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|429|502|503|504|<!doctype html>|<html|техническ/i.test(String(error?.message ?? ""));
}

function formatAxiosError(error, prefix) {
  const responseData = error?.response?.data;
  if (responseData?.errors?.length) {
    return `${prefix} error: ${responseData.errors.map((entry) => entry.message).join("; ")}`;
  }
  if (typeof responseData === "string" && responseData.trim()) {
    return `${prefix} error: ${responseData}`;
  }
  if (responseData && typeof responseData === "object") {
    return `${prefix} error: ${JSON.stringify(responseData)}`;
  }
  return `${prefix} error: ${error?.message ?? "Unknown error"}`;
}
