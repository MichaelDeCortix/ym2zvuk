function splitHosts(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildNoProxyValue(baseValue, hosts) {
  return Array.from(new Set([...splitHosts(baseValue), ...hosts])).join(",");
}

export function buildNoProxyEnv(hosts, baseEnv = process.env) {
  const noProxy = buildNoProxyValue(baseEnv.NO_PROXY ?? baseEnv.no_proxy ?? "", hosts);
  return {
    ...baseEnv,
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: ""
  };
}

export function applyNoProxy(hosts) {
  const env = buildNoProxyEnv(hosts, process.env);
  Object.assign(process.env, env);
  return env;
}
