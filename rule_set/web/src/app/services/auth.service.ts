import { HttpClient } from "@angular/common/http";
import { Injectable, computed, signal } from "@angular/core";
import { Observable, tap } from "rxjs";

const TOKEN_KEY = "auth_token";

export interface LoginResponse {
  token: string;
  expiresIn: string;
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private readonly baseUrl = "/api";
  private readonly tokenSig = signal<string | null>(localStorage.getItem(TOKEN_KEY));

  /** Computed signal: true when a token is stored in localStorage. */
  readonly isAuthenticated = computed(() => this.tokenSig() !== null);

  /**
   * Computed signal: the `role` claim decoded client-side from the JWT payload.
   * UI-defense only — no signature verification needed here, the real
   * authorization gate is the server's `requireRole` middleware. Falsy
   * (null) when there's no token or the token is malformed.
   */
  readonly role = computed<string | null>(() => {
    const token = this.tokenSig();
    if (!token) return null;
    const payload = AuthService.decodeJwtPayload(token);
    return typeof payload?.["role"] === "string" ? (payload["role"] as string) : null;
  });

  /** Computed signal: true when the decoded `role` claim is "admin". */
  readonly isAdmin = computed(() => this.role() === "admin");

  constructor(private readonly http: HttpClient) {}

  /** POST /api/auth/login — stores the returned token in localStorage. */
  login(email: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.baseUrl}/auth/login`, { email, password })
      .pipe(tap((res) => this.setToken(res.token)));
  }

  /** Returns the currently stored JWT, or null if the user is not logged in. */
  getToken(): string | null {
    return this.tokenSig();
  }

  /** Clears the stored token from localStorage and from the signal. */
  logout(): void {
    this.setToken(null);
  }

  private setToken(token: string | null): void {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
    this.tokenSig.set(token);
  }

  /**
   * Base64url-decodes the payload segment (2nd part) of a JWT and parses it
   * as JSON. Returns null (never throws) if the token doesn't have the
   * expected 3-segment shape or the payload isn't valid base64url/JSON.
   */
  private static decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      let base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const paddingNeeded = (4 - (base64.length % 4)) % 4;
      base64 += "=".repeat(paddingNeeded);
      const json = atob(base64);
      const parsed = JSON.parse(json);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
}
