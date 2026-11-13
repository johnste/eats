import type {
  BarcodeLookupResponse,
  CreateFoodBody,
  CreateLogBody,
  DayResponse,
  DaySummaryResponse,
  DuplicateGroupResponse,
  FoodResponse,
  FoodSearchResponse,
  GoalBody,
  LogEntryResponse,
  Meal,
  OcrResponse,
  ProfileBody,
  UserResponse,
} from '@eats/shared';

/** An API error carrying the server's message, which is written for humans. */
export class ApiError extends Error {
  // Declared explicitly rather than as a constructor parameter property:
  // erasableSyntaxOnly forbids those, and that flag is what lets Node run
  // this TypeScript without a build step.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/**
 * Long enough for a slow phone connection, short enough to be an answer.
 *
 * Without one, fetch waits indefinitely, and a host that accepts the
 * connection but never replies -- a wedged server rather than a missing one
 * -- leaves every query pending forever. That is a spinner that never
 * resolves, which tells you nothing; a timeout at least becomes an error the
 * app can show.
 */
const TIMEOUT_MS = 15_000;
/** Scanning uploads a photo and waits on OCR, which is legitimately slow. */
const OCR_TIMEOUT_MS = 60_000;

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'same-origin',
      // Only declare a JSON body when there is one. Sending the header with an
      // empty body makes Fastify reject the request outright, which silently
      // broke every bodyless call -- deleting a log entry, and signing out.
      headers:
        init.body === undefined || init.body instanceof FormData
          ? init.headers
          : { 'content-type': 'application/json', ...init.headers },
    });
  } catch (err) {
    // A timeout and a refused connection are different problems and deserve
    // different sentences: one is the server, the other is probably you.
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    throw new ApiError(
      timedOut
        ? "The server isn't responding. It may be down — try again shortly."
        : "Can't reach the server. Check your connection.",
      0,
    );
  }

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : 'Something went wrong.';
    throw new ApiError(message, res.status);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path);
const send = <T>(method: string, path: string, body?: unknown) =>
  request<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const api = {
  me: () => get<UserResponse>('/auth/me'),
  login: (body: { email: string; password: string }) =>
    send<UserResponse>('POST', '/auth/login', body),
  register: (body: {
    email: string;
    password: string;
    displayName: string;
    inviteCode: string;
  }) => send<UserResponse>('POST', '/auth/register', body),
  logout: () => send<{ ok: boolean }>('POST', '/auth/logout'),

  day: (date: string) => get<DayResponse>(`/log?date=${date}`),
  summary: (from: string, to: string) =>
    get<DaySummaryResponse[]>(`/log/summary?from=${from}&to=${to}`),
  addEntry: (body: CreateLogBody) => send<LogEntryResponse>('POST', '/log', body),
  updateEntry: (
    id: string,
    body: { grams?: number; meal?: string; loggedOn?: string },
  ) => send<LogEntryResponse>('PATCH', `/log/${id}`, body),
  deleteEntry: (id: string) => send<{ ok: boolean }>('DELETE', `/log/${id}`),

  searchFoods: (q: string) =>
    get<FoodSearchResponse>(`/foods/search?q=${encodeURIComponent(q)}`),
  recentFoods: (meal?: Meal) =>
    get<FoodResponse[]>(`/foods/recent${meal ? `?meal=${meal}` : ''}`),
  companions: (ids: string[]) =>
    get<FoodResponse[]>(`/foods/companions?ids=${ids.join(',')}`),
  barcode: (code: string) => get<BarcodeLookupResponse>(`/foods/barcode/${code}`),
  food: (id: string) => get<FoodResponse>(`/foods/${id}`),
  createFood: (body: CreateFoodBody) => send<FoodResponse>('POST', '/foods', body),
  updateFood: (id: string, body: CreateFoodBody) =>
    send<FoodResponse>('PATCH', `/foods/${id}`, body),
  duplicates: () => get<DuplicateGroupResponse[]>('/foods/duplicates'),
  mergeFoods: (sourceId: string, targetId: string) =>
    send<{ moved: number }>('POST', '/foods/merge', { sourceId, targetId }),
  brands: () => get<string[]>('/foods/brands'),

  /**
   * Fetched as a blob rather than linked to directly, so a failure surfaces in
   * the UI instead of replacing the app with a JSON error page.
   */
  exportData: async (): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch('/api/export', { credentials: 'same-origin' });
    if (!res.ok) {
      throw new ApiError('Could not prepare your export.', res.status);
    }
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="([^"]+)"/);
    return {
      blob: await res.blob(),
      filename: match?.[1] ?? 'eats-export.json',
    };
  },

  scanLabel: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    return request<OcrResponse>(
      '/foods/ocr',
      { method: 'POST', body: form },
      OCR_TIMEOUT_MS,
    );
  },

  profile: () => get<ProfileBody>('/profile'),
  saveProfile: (body: ProfileBody) => send<ProfileBody>('PUT', '/profile', body),
  goals: () => get<(GoalBody & { effectiveFrom: string }) | null>('/goals'),
  saveGoals: (body: GoalBody) => send<GoalBody>('PUT', '/goals', body),
  tdee: (goal = 'maintain', kgPerWeek = 0.5) =>
    get<{
      tdee: number;
      bmr: number;
      weightKg: number;
      calories: number;
      dailyDelta: number;
      limited: boolean;
      suggested: { proteinG: number; carbsG: number; fatG: number };
    }>(`/tdee?goal=${goal}&kgPerWeek=${kgPerWeek}`),

  tokens: () =>
    get<
      {
        id: string;
        name: string;
        hint: string;
        lastUsedAt: string | null;
        createdAt: string;
      }[]
    >('/tokens'),
  tokenSuggestion: () => get<{ secret: string }>('/tokens/suggestion'),
  connections: () =>
    get<
      {
        clientId: string;
        clientName: string;
        connectedAt: string | null;
        lastUsedAt: string | null;
      }[]
    >('/connections'),
  disconnect: (clientId: string) =>
    send<{ ok: boolean }>('DELETE', `/connections/${clientId}`),
  createToken: (name: string, secret: string) =>
    send<{ id: string; secret: string }>('POST', '/tokens', { name, secret }),
  revokeToken: (id: string) => send<{ ok: boolean }>('DELETE', `/tokens/${id}`),

  weights: (from: string, to: string) =>
    get<{ measuredOn: string; weightKg: number }[]>(`/weights?from=${from}&to=${to}`),
  addWeight: (body: { measuredOn: string; weightKg: number }) =>
    send<{ measuredOn: string; weightKg: number }>('POST', '/weights', body),
  deleteWeight: (date: string) => send<{ ok: boolean }>('DELETE', `/weights/${date}`),
};
