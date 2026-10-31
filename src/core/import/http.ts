export interface HttpConfig {
  /** Only set outside the browser; browsers send their own and won't let pages override it. */
  userAgent?: string;
  signal?: AbortSignal;
  /** Told when we pause, so the UI can say why it looks stuck. */
  onWait?: (ms: number, reason: string) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/**
 * GET with backoff. On 429 waits `rateLimitWaitMs` (Lichess asks for a full
 * minute) or the Retry-After header; on network errors and 5xx retries a few
 * times with growing pauses. Returns 4xx other than 429 to the caller.
 */
export async function getWithBackoff(
  url: string,
  accept: string,
  cfg: HttpConfig,
  rateLimitWaitMs = 60_000,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept };
  if (cfg.userAgent) headers['User-Agent'] = cfg.userAgent;
  let rateLimited = 0;
  let failures = 0;
  for (;;) {
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers, signal: cfg.signal });
    } catch (e) {
      if (cfg.signal?.aborted) throw e;
    }
    if (res && res.status === 429 && rateLimited < 5) {
      rateLimited++;
      const retryAfter = Number(res.headers.get('Retry-After'));
      const wait = retryAfter > 0 ? retryAfter * 1000 : rateLimitWaitMs;
      cfg.onWait?.(wait, 'rate limited');
      await sleep(wait, cfg.signal);
      continue;
    }
    if ((!res || res.status >= 500) && failures < 3) {
      failures++;
      const wait = 2000 * failures ** 2;
      cfg.onWait?.(wait, res ? `HTTP ${res.status}` : 'network error');
      await sleep(wait, cfg.signal);
      continue;
    }
    if (!res) throw new Error(`Network error fetching ${url}`);
    return res;
  }
}

/** Yields each non-empty line of a streamed response body. */
export async function* readLines(res: Response): AsyncGenerator<string> {
  if (!res.body) {
    for (const line of (await res.text()).split('\n')) if (line.trim()) yield line;
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  if (buf.trim()) yield buf.trim();
}
