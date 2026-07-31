// Typed wrapper around fetch for the local API.
//
// Replaces 74 hand-written fetch calls that each repeated the headers, the
// JSON parse, and a slightly different error check. Three things it adds:
//
//   * The x-repo-path header is attached once, from the store, instead of at
//     45 call sites.
//   * A failed response becomes a thrown ApiError carrying the server's own
//     message, so callers stop writing `data.error || 'Something failed'`.
//   * Requests are tied to a repository generation. Switching repositories
//     quickly used to let a slow response from the previous repository
//     resolve last and overwrite the new repository's state.

export class ApiError extends Error {
  readonly status: number;
  /** Extra fields the server sent alongside `error`, such as notFullyMerged. */
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/** Thrown when a request is superseded by a repository change. */
export class StaleRequestError extends Error {
  constructor() {
    super('Request superseded by a newer repository selection');
    this.name = 'StaleRequestError';
  }
}

let activeRepoPath: string | null = null;
let generation = 0;
let controller = new AbortController();

/**
 * Points subsequent requests at a repository and abandons in-flight ones.
 *
 * Called whenever the active repository changes, including to null.
 */
export function setActiveRepo(repoPath: string | null): void {
  if (activeRepoPath === repoPath) {
    return;
  }

  activeRepoPath = repoPath;
  generation += 1;
  controller.abort();
  controller = new AbortController();
}

export function getActiveRepo(): string | null {
  return activeRepoPath;
}

/** The generation a caller can compare against to detect a stale result. */
export function currentGeneration(): number {
  return generation;
}

export function isCurrentGeneration(captured: number): boolean {
  return captured === generation;
}

export interface RequestOptions {
  /** Sent as a JSON body. */
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Adds the x-repo-path header. Defaults to true. */
  repoScoped?: boolean;
  /** Survives a repository switch. Used by config and template requests. */
  ignoreRepoGeneration?: boolean;
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  if (!query) {
    return path;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }

  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { repoScoped = true, ignoreRepoGeneration = false } = options;

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (repoScoped) {
    if (activeRepoPath === null) {
      throw new ApiError('No repository is open.', 400);
    }
    headers['x-repo-path'] = activeRepoPath;
  }

  const capturedGeneration = generation;

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }
  if (!ignoreRepoGeneration) {
    init.signal = controller.signal;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new StaleRequestError();
    }
    throw error;
  }

  // A response that arrives after the user switched repositories describes a
  // repository that is no longer on screen.
  if (!ignoreRepoGeneration && capturedGeneration !== generation) {
    throw new StaleRequestError();
  }

  let payload: unknown = null;
  const text = await response.text();
  if (text !== '') {
    try {
      payload = JSON.parse(text);
    } catch {
      // A non-JSON body from a route that should always answer JSON.
      if (!response.ok) {
        throw new ApiError(text.slice(0, 200), response.status);
      }
    }
  }

  const data = (payload ?? {}) as Record<string, unknown>;

  if (!response.ok) {
    const message =
      typeof data['error'] === 'string' ? data['error'] : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('POST', path, options),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options)
};

/** True for errors that mean "this answer no longer matters", not "this failed". */
export function isStale(error: unknown): boolean {
  return error instanceof StaleRequestError;
}

/** The message worth showing a user for any thrown value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}
