import type {
  BarcodeLookupResponse,
  CreateFoodBody,
  CreateLogBody,
  DayResponse,
  FoodResponse,
  FoodSearchResponse,
  GoalBody,
  LogEntryResponse,
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      // Only declare a JSON body when there is one. Sending the header with an
      // empty body makes Fastify reject the request outright, which silently
      // broke every bodyless call -- deleting a log entry, and signing out.
      headers:
        init.body === undefined || init.body instanceof FormData
          ? init.headers
          : { 'content-type': 'application/json', ...init.headers },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
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
  request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

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
    get<{ date: string; kcal: number; proteinG: number; carbsG: number; fatG: number }[]>(
      `/log/summary?from=${from}&to=${to}`,
    ),
  addEntry: (body: CreateLogBody) => send<LogEntryResponse>('POST', '/log', body),
  updateEntry: (id: string, body: { grams?: number; meal?: string }) =>
    send<LogEntryResponse>('PATCH', `/log/${id}`, body),
  deleteEntry: (id: string) => send<{ ok: boolean }>('DELETE', `/log/${id}`),

  searchFoods: (q: string) =>
    get<FoodSearchResponse>(`/foods/search?q=${encodeURIComponent(q)}`),
  recentFoods: () => get<FoodResponse[]>('/foods/recent'),
  barcode: (code: string) => get<BarcodeLookupResponse>(`/foods/barcode/${code}`),
  createFood: (body: CreateFoodBody) => send<FoodResponse>('POST', '/foods', body),
  brands: () => get<string[]>('/foods/brands'),

  scanLabel: (file: File) => {
    const form = new FormData();
    form.append('image', file);
    return request<OcrResponse>('/foods/ocr', { method: 'POST', body: form });
  },

  profile: () => get<ProfileBody>('/profile'),
  saveProfile: (body: ProfileBody) => send<ProfileBody>('PUT', '/profile', body),
  goals: () => get<(GoalBody & { effectiveFrom: string }) | null>('/goals'),
  saveGoals: (body: GoalBody) => send<GoalBody>('PUT', '/goals', body),
  tdee: () =>
    get<{
      tdee: number;
      weightKg: number;
      suggested: { proteinG: number; carbsG: number; fatG: number };
    }>('/tdee'),

  weights: (from: string, to: string) =>
    get<{ measuredOn: string; weightKg: number }[]>(`/weights?from=${from}&to=${to}`),
  addWeight: (body: { measuredOn: string; weightKg: number }) =>
    send<{ measuredOn: string; weightKg: number }>('POST', '/weights', body),
  deleteWeight: (date: string) => send<{ ok: boolean }>('DELETE', `/weights/${date}`),
};
