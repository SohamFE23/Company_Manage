export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

function formatApiDetail(detail: unknown, status: number): string {
  if (typeof detail === "string" && detail) return detail;

  if (Array.isArray(detail)) {
    const messages = detail.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") return String(entry);
      const error = entry as { loc?: unknown; msg?: unknown };
      const location = Array.isArray(error.loc)
        ? error.loc.filter((part) => typeof part === "string").join(".")
        : "";
      const message =
        typeof error.msg === "string" ? error.msg : "Invalid value";
      return location ? `${location}: ${message}` : message;
    });
    if (messages.length) return messages.join("; ");
  }

  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
    try {
      return JSON.stringify(detail) ?? `Request failed (${status})`;
    } catch {
      return `Request failed (${status})`;
    }
  }

  return `Request failed (${status})`;
}

export class ApiError extends Error {
  public readonly detail: unknown;
  public readonly status: number;

  constructor(
    detail: unknown,
    status: number,
  ) {
    super(formatApiDetail(detail, status));
    this.name = "ApiError";
    this.detail = detail;
    this.status = status;
  }
}

async function responseError(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "detail" in body) {
      return new ApiError(body.detail, response.status);
    }
  } catch {
    return new ApiError(null, response.status);
  }
  return new ApiError(null, response.status);
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<{ access_token: string; token_type: string }> {
  const body = new URLSearchParams();
  body.set("username", email.trim().toLowerCase());
  body.set("password", password);

  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw await responseError(response);
  }

  return response.json() as Promise<{
    access_token: string;
    token_type: string;
  }>;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionStorage.getItem("opsflow_access_token");
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    sessionStorage.removeItem("opsflow_access_token");
    window.dispatchEvent(new Event("opsflow:unauthorized"));
  }

  if (!response.ok) {
    throw await responseError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
