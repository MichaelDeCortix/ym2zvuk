export const PACKAGE_NAME = "ym2zvuk";
export const PACKAGE_VERSION = "0.2.0";

export const DEFAULT_YANDEX_BASE_URL = "https://api.music.yandex.net";
export const DEFAULT_ZVUK_BASE_URL = "https://zvuk.com";

export const YANDEX_NO_PROXY_HOSTS = [
  "api.music.yandex.net",
  "music.yandex.ru",
  ".yandex.net",
  ".yandex.ru"
];

export const ZVUK_NO_PROXY_HOSTS = [
  "zvuk.com",
  ".zvuk.com"
];

export const GLOBAL_FILE_NAMES = {
  config: "config.json",
  overrides: "overrides.csv",
  templates: "zvuk-write-templates.json",
  probeCapture: "zvuk-probe-capture.json"
};

export const RUN_FILE_NAMES = {
  manifest: "run-manifest.json",
  export: "export.json",
  exportSummary: "export-summary.json",
  matchReport: "match-report.json",
  unmatchedCsv: "unmatched.csv",
  migrationReport: "migration-report.json",
  migrationMarkdown: "migration-report.md",
  checkpoint: "import-checkpoint.json",
  verifyReport: "verification-report.json"
};

export const PLAYLIST_PROBE_SENTINEL = "__CODEX_PROBE_PLAYLIST__";

export const REQUIRED_TEMPLATE_ACTIONS = [
  "like_track",
  "create_playlist",
  "add_track_to_playlist"
];

export const DEFAULT_MATCH_OPTIONS = {
  perQueryLimit: 7,
  fuzzyThreshold: 0.82
};

export const REPORT_FORMATS = new Set(["console", "json", "csv", "all"]);
