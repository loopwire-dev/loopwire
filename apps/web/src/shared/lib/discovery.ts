const DISCOVERY_CACHE_KEY = "loopwire_discovered_url";
const DISCOVERY_TIMEOUT_MS = 2000;
const DEFAULT_PORT = 9400;

interface HealthResponse {
  status: string;
  version: string;
  lan_addresses?: string[];
}

async function probeHealth(baseUrl: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const resp = await fetch(`${baseUrl}/api/v1/health`, {
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body: HealthResponse = await resp.json();
    if (body.status !== "ok") throw new Error("unhealthy");
    return baseUrl;
  } finally {
    clearTimeout(timeout);
  }
}

function isLanHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".local")) return true;

  // Check private IPv4 ranges
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }

  return false;
}

function buildCandidates(port: number): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const add = (url: string) => {
    const normalized = url.replace(/\/$/, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };

  // 1. localhost (most likely for same-machine)
  add(`http://localhost:${port}`);

  // 2. 127.0.0.1 numeric fallback
  add(`http://127.0.0.1:${port}`);

  // 3. If the frontend is served from a LAN host (e.g. navigated to 192.168.1.50:5173
  //    or myhost.local:5173), also try that host on the daemon port.
  //    Skip public hostnames (e.g. loopwire.dev) — probing those would fail or hit
  //    the wrong server.
  const locationHost = window.location.hostname;
  if (locationHost && isLanHost(locationHost)) {
    add(`http://${locationHost}:${port}`);
  }

  return candidates;
}

export async function discoverDaemon(
  port: number = DEFAULT_PORT,
): Promise<string | null> {
  // Check cache first
  const cached = sessionStorage.getItem(DISCOVERY_CACHE_KEY);
  if (cached) {
    try {
      await probeHealth(cached);
      return cached;
    } catch {
      sessionStorage.removeItem(DISCOVERY_CACHE_KEY);
    }
  }

  const candidates = buildCandidates(port);
  if (candidates.length === 0) return null;

  try {
    const winner = await Promise.any(candidates.map((url) => probeHealth(url)));
    sessionStorage.setItem(DISCOVERY_CACHE_KEY, winner);
    return winner;
  } catch {
    // All candidates failed
    return null;
  }
}

export function clearDiscoveryCache(): void {
  sessionStorage.removeItem(DISCOVERY_CACHE_KEY);
}
