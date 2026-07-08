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
}
