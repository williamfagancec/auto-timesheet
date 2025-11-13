/**
 * RM (Resource Management by Smartsheet) API Client
 * Low-level HTTP client for RM API with rate limiting and error handling
 */

const RM_BASE_URL = "https://api.rm.smartsheet.com/api/v1";

/**
 * RM API Error Response
 */
interface RMErrorResponse {
  error?: string;
  message?: string;
  errors?: Array<{ field: string; message: string }>;
}

/**
 * RM User Object
 */
export interface RMUser {
  id: number;
  email: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  account_id?: number;
}

/**
 * RM Project Object
 */
export interface RMProject {
  id: number;
  name: string;
  code?: string;
  client_name?: string;
  archived?: boolean;
}

/**
 * RM Time Entry Object
 */
export interface RMTimeEntry {
  id: number;
  user_id: number;
  assignable_id: number; // Project ID
  date: string; // YYYY-MM-DD
  hours: number;
  task?: string;
  notes?: string;
  is_suggestion?: boolean;
}

/**
 * Create Time Entry Input
 */
export interface CreateRMTimeEntryInput {
  assignable_id: number; // Project ID
  date: string; // YYYY-MM-DD
  hours: number;
  task?: string;
  notes?: string;
}

/**
 * Update Time Entry Input
 */
export interface UpdateRMTimeEntryInput {
  assignable_id?: number;
  date?: string;
  hours?: number;
  task?: string;
  notes?: string;
}

/**
 * RM API Client Class
 */
export class RMApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = RM_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make HTTP request to RM API
   */
  private async request<T>(
    endpoint: string,
    token: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: HeadersInit = {
      "Content-Type": "application/json",
      auth: token,
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        throw new RMRateLimitError(
          `Rate limit exceeded${retryAfter ? `, retry after ${retryAfter}s` : ""}`
        );
      }

      // Handle authentication errors (401, 403)
      if (response.status === 401 || response.status === 403) {
        const errorData = await response.json().catch(() => ({}));
        throw new RMAuthError(
          errorData.error || errorData.message || "Invalid API token"
        );
      }

      // Handle not found (404)
      if (response.status === 404) {
        throw new RMNotFoundError("Resource not found");
      }

      // Handle validation errors (400, 422)
      if (response.status === 400 || response.status === 422) {
        const errorData: RMErrorResponse = await response
          .json()
          .catch(() => ({}));
        const errorMessage =
          errorData.error ||
          errorData.message ||
          errorData.errors?.map((e) => `${e.field}: ${e.message}`).join(", ") ||
          "Validation error";
        throw new RMValidationError(errorMessage);
      }

      // Handle server errors (500+)
      if (response.status >= 500) {
        throw new RMNetworkError(
          `RM API server error (${response.status}): ${response.statusText}`
        );
      }

      // Handle other error responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new RMNetworkError(
          errorData.error || errorData.message || `HTTP ${response.status}`
        );
      }

      return await response.json();
    } catch (error) {
      // Re-throw our custom errors
      if (error instanceof RMApiError) {
        throw error;
      }

      // Network errors (timeout, DNS, etc.)
      if (error instanceof TypeError) {
        throw new RMNetworkError(`Network error: ${error.message}`);
      }

      // Unknown errors
      throw new RMNetworkError(
        `Unknown error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get list of users
   * Used to validate token and get authenticated user info
   */
  async getUsers(token: string, page: number = 1): Promise<{ data: RMUser[] }> {
    return this.request<{ data: RMUser[] }>(
      `/users?page=${page}`,
      token,
      {
        method: "GET",
      }
    );
  }

  /**
   * Validate token and get authenticated user info
   * Returns the first user (assumes single-user token or self-user)
   */
  async validateToken(token: string): Promise<RMUser> {
    const response = await this.getUsers(token, 1);

    if (!response.data || response.data.length === 0) {
      throw new RMAuthError("No users found - invalid token or insufficient permissions");
    }

    // Return the first user (for personal API tokens, this is typically the authenticated user)
    // TODO: In production, may need to call a /users/me endpoint if RM API provides one
    return response.data[0];
  }

  /**
   * Get time entries for a date range
   */
  async getTimeEntries(
    token: string,
    from: string,
    to: string,
    page: number = 1
  ): Promise<{ data: RMTimeEntry[] }> {
    return this.request<{ data: RMTimeEntry[] }>(
      `/time_entries?from=${from}&to=${to}&page=${page}&per_page=1000`,
      token,
      {
        method: "GET",
      }
    );
  }

  /**
   * Create a time entry
   */
  async createTimeEntry(
    token: string,
    userId: number,
    entry: CreateRMTimeEntryInput
  ): Promise<RMTimeEntry> {
    return this.request<RMTimeEntry>(
      `/users/${userId}/time_entries`,
      token,
      {
        method: "POST",
        body: JSON.stringify(entry),
      }
    );
  }

  /**
   * Update a time entry
   */
  async updateTimeEntry(
    token: string,
    userId: number,
    entryId: number,
    updates: UpdateRMTimeEntryInput
  ): Promise<RMTimeEntry> {
    return this.request<RMTimeEntry>(
      `/users/${userId}/time_entries/${entryId}`,
      token,
      {
        method: "PUT",
        body: JSON.stringify(updates),
      }
    );
  }

  /**
   * Delete a time entry
   */
  async deleteTimeEntry(
    token: string,
    userId: number,
    entryId: number
  ): Promise<void> {
    await this.request<void>(
      `/users/${userId}/time_entries/${entryId}`,
      token,
      {
        method: "DELETE",
      }
    );
  }

  /**
   * Get list of projects
   */
  async getProjects(
    token: string,
    page: number = 1
  ): Promise<{ data: RMProject[] }> {
    return this.request<{ data: RMProject[] }>(
      `/projects?page=${page}&per_page=1000`,
      token,
      {
        method: "GET",
      }
    );
  }
}

/**
 * Custom Error Classes for RM API
 */
export class RMApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RMApiError";
  }
}

export class RMAuthError extends RMApiError {
  constructor(message: string) {
    super(message);
    this.name = "RMAuthError";
  }
}

export class RMRateLimitError extends RMApiError {
  constructor(message: string) {
    super(message);
    this.name = "RMRateLimitError";
  }
}

export class RMValidationError extends RMApiError {
  constructor(message: string) {
    super(message);
    this.name = "RMValidationError";
  }
}

export class RMNotFoundError extends RMApiError {
  constructor(message: string) {
    super(message);
    this.name = "RMNotFoundError";
  }
}

export class RMNetworkError extends RMApiError {
  constructor(message: string) {
    super(message);
    this.name = "RMNetworkError";
  }
}

/**
 * Default RM API client instance
 */
export const rmApi = new RMApiClient();
