import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";

import { AuthService } from "./auth.service";

// ---------------------------------------------------------------------------
// Test helper — builds a fake JWT (base64url header.payload.signature) so
// tests never depend on the real backend/jsonwebtoken.
// ---------------------------------------------------------------------------
function makeToken(payload: Record<string, unknown>): string {
  const toBase64Url = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = toBase64Url({ alg: "HS256", typ: "JWT" });
  const body = toBase64Url(payload);
  return `${header}.${body}.fake-signature`;
}

// ---------------------------------------------------------------------------
// AuthService unit tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    // Clear localStorage before each test so signal initialises fresh.
    localStorage.removeItem("auth_token");

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AuthService],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.removeItem("auth_token");
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------
  it("should start unauthenticated when localStorage is empty", () => {
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.getToken()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------
  it("login() sends POST /api/auth/login with email and password", () => {
    service.login("user@bank.com", "secret").subscribe();

    const req = httpMock.expectOne("/api/auth/login");
    expect(req.request.method).toBe("POST");
    expect(req.request.body).toEqual({ email: "user@bank.com", password: "secret" });
    req.flush({ token: "tok123", expiresIn: "8h" });
  });

  it("login() stores the returned token in localStorage", () => {
    service.login("user@bank.com", "secret").subscribe();

    const req = httpMock.expectOne("/api/auth/login");
    req.flush({ token: "tok123", expiresIn: "8h" });

    expect(localStorage.getItem("auth_token")).toBe("tok123");
  });

  it("login() sets isAuthenticated to true after successful response", () => {
    service.login("user@bank.com", "secret").subscribe();

    const req = httpMock.expectOne("/api/auth/login");
    req.flush({ token: "tok123", expiresIn: "8h" });

    expect(service.isAuthenticated()).toBeTrue();
    expect(service.getToken()).toBe("tok123");
  });

  // -------------------------------------------------------------------------
  // logout()
  // -------------------------------------------------------------------------
  it("logout() clears the token from localStorage and signal", () => {
    // Seed a token first.
    service.login("user@bank.com", "secret").subscribe();
    httpMock.expectOne("/api/auth/login").flush({ token: "tok123", expiresIn: "8h" });

    service.logout();

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(service.isAuthenticated()).toBeFalse();
    expect(service.getToken()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // role() / isAdmin() — T-13b: client-side JWT payload decode (UI defense only)
  // -------------------------------------------------------------------------
  it("role() and isAdmin() are falsy when no token is stored", () => {
    expect(service.role()).toBeFalsy();
    expect(service.isAdmin()).toBeFalse();
  });

  it("role() returns 'admin' and isAdmin() is true for a valid admin token", () => {
    const token = makeToken({ userId: 1, email: "admin@bank.com", role: "admin" });
    service.login("admin@bank.com", "secret").subscribe();
    httpMock.expectOne("/api/auth/login").flush({ token, expiresIn: "8h" });

    expect(service.role()).toBe("admin");
    expect(service.isAdmin()).toBeTrue();
  });

  it("role() returns 'viewer' and isAdmin() is false for a valid viewer token", () => {
    const token = makeToken({ userId: 2, email: "viewer@bank.com", role: "viewer" });
    service.login("viewer@bank.com", "secret").subscribe();
    httpMock.expectOne("/api/auth/login").flush({ token, expiresIn: "8h" });

    expect(service.role()).toBe("viewer");
    expect(service.isAdmin()).toBeFalse();
  });

  it("role() and isAdmin() are falsy (not throwing) for a malformed token", () => {
    service.login("user@bank.com", "secret").subscribe();
    httpMock.expectOne("/api/auth/login").flush({ token: "not-a-valid-jwt", expiresIn: "8h" });

    expect(() => service.role()).not.toThrow();
    expect(service.role()).toBeFalsy();
    expect(service.isAdmin()).toBeFalse();
  });
});
