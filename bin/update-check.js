// Update-check helpers for the launcher, split out so the version comparison is
// unit-testable. Network calls are best-effort and never throw.

const REGISTRY = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/$/, "");

// Best-effort latest-version lookup. Resolves null on any failure (offline,
// timeout, non-OK, bad payload) so callers never block or break startup.
export async function fetchLatestVersion(pkg = "mulmoterminal") {
  try {
    const res = await fetch(`${REGISTRY}/${pkg}/latest`, {
      signal: AbortSignal.timeout(1500),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

// True if `latest` is a strictly newer major.minor.patch than `current`.
// Pre-release suffixes are ignored and parts are compared numerically (so
// 0.1.10 > 0.1.9, which a lexical compare would get wrong).
export function isNewerVersion(latest, current) {
  const parts = (v) =>
    String(v)
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}
