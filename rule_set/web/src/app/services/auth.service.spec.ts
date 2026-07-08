import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";

import { AuthService } from "./auth.service";

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
});
