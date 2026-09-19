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
} from "@eats/shared";

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
      credentials: "same-origin",
      // Only declare a JSON body when there is one. Sending the header with an
      // empty body makes Fastify reject the request outright, which silently
      // broke every bodyless call -- deleting a log entry, and signing out.
      headers:
        init.body === undefined || init.body instanceof FormData
          ? init.headers
          : { "content-type": "application/json", ...init.headers },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection.", 0);
  }

  if (res.status === 204) return undefined as T;

  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: unknown }).error)
        : "Something went wrong.";
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
  me: () => get<UserResponse>("/auth/me"),
  login: (body: { email: string; password: string }) =>
    send<UserResponse>("POST", "/auth/login", body),
  register: (body: {
    email: string;
    password: string;
    displayName: string;
    inviteCode: string;
  }) => send<UserResponse>("POST", "/auth/register", body),
  logout: () => send<{ ok: boolean }>("POST", "/auth/logout"),

  day: (date: string) => get<DayResponse>(`/log?date=${date}`),
  summary: (from: string, to: string) =>
    get<
      {
        date: string;
        kcal: number;
        proteinG: number;
        carbsG: number;
        fatG: number;
      }[]
    >(`/log/summary?from=${from}&to=${to}`),
  addEntry: (body: CreateLogBody) =>
    send<LogEntryResponse>("POST", "/log", body),
  updateEntry: (
    id: string,
    body: { grams?: number; meal?: string; loggedOn?: string },
  ) => send<LogEntryResponse>("PATCH", `/log/${id}`, body),
  deleteEntry: (id: string) => send<{ ok: boolean }>("DELETE", `/log/${id}`),

  searchFoods: (q: string) =>
    get<FoodSearchResponse>(`/foods/search?q=${encodeURIComponent(q)}`),
  recentFoods: () => get<FoodResponse[]>("/foods/recent"),
  barcode: (code: string) =>
    get<BarcodeLookupResponse>(`/foods/barcode/${code}`),
  food: (id: string) => get<FoodResponse>(`/foods/${id}`),
  createFood: (body: CreateFoodBody) =>
    send<FoodResponse>("POST", "/foods", body),
  updateFood: (id: string, body: CreateFoodBody) =>
    send<FoodResponse>("PATCH", `/foods/${id}`, body),
  brands: () => get<string[]>("/foods/brands"),

  /**
   * Fetched as a blob rather than linked to directly, so a failure surfaces in
   * the UI instead of replacing the app with a JSON error page.
   */
  exportData: async (): Promise<{ blob: Blob; filename: string }> => {
    const res = await fetch("/api/export", { credentials: "same-origin" });
    if (!res.ok) {
      throw new ApiError("Could not prepare your export.", res.status);
    }
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename="([^"]+)"/);
    return {
      blob: await res.blob(),
      filename: match?.[1] ?? "eats-export.json",
    };
  },

  scanLabel: (file: File) => {
    const form = new FormData();
    form.append("image", file);
    return request<OcrResponse>("/foods/ocr", { method: "POST", body: form });
  },

  profile: () => get<ProfileBody>("/profile"),
  saveProfile: (body: ProfileBody) =>
    send<ProfileBody>("PUT", "/profile", body),
  goals: () => get<(GoalBody & { effectiveFrom: string }) | null>("/goals"),
  saveGoals: (body: GoalBody) => send<GoalBody>("PUT", "/goals", body),
  tdee: (goal = "maintain", kgPerWeek = 0.5) =>
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
    >("/tokens"),
  tokenSuggestion: () => get<{ secret: string }>("/tokens/suggestion"),
  createToken: (name: string, secret: string) =>
    send<{ id: string; secret: string }>("POST", "/tokens", { name, secret }),
  revokeToken: (id: string) => send<{ ok: boolean }>("DELETE", `/tokens/${id}`),

  weights: (from: string, to: string) =>
    get<{ measuredOn: string; weightKg: number }[]>(
      `/weights?from=${from}&to=${to}`,
    ),
  addWeight: (body: { measuredOn: string; weightKg: number }) =>
    send<{ measuredOn: string; weightKg: number }>("POST", "/weights", body),
  deleteWeight: (date: string) =>
    send<{ ok: boolean }>("DELETE", `/weights/${date}`),
};
