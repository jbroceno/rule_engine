import { TestBed } from "@angular/core/testing";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from "@angular/common/http";
import { Router } from "@angular/router";
import { signal } from "@angular/core";

import { authInterceptor } from "./auth.interceptor";
import { AuthService } from "../services/auth.service";

// ---------------------------------------------------------------------------
// authInterceptor unit tests
// ---------------------------------------------------------------------------

describe("authInterceptor", () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let routerSpy: jasmine.SpyObj<Router>;
  let fakeAuth: { isAuthenticated: ReturnType<typeof signal<boolean>>; getToken: jasmine.Spy; logout: jasmine.Spy };

  function setup(token: string | null = "test-token") {
    fakeAuth = {
      isAuthenticated: signal(token !== null),
      getToken: jasmine.createSpy("getToken").and.returnValue(token),
      logout: jasmine.createSpy("logout"),
    };
    routerSpy = jasmine.createSpyObj<Router>("Router", ["navigate"]);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: fakeAuth },
        { provide: Router, useValue: routerSpy },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  }

  afterEach(() => {
    httpMock.verify();
  });

  // -------------------------------------------------------------------------
  // Token attachment
  // -------------------------------------------------------------------------

  it("attaches Authorization: Bearer header to non-login requests when token is present", () => {
    setup("my-jwt-token");

    http.get("/api/config").subscribe();

    const req = httpMock.expectOne("/api/config");
    expect(req.request.headers.get("Authorization")).toBe("Bearer my-jwt-token");
    req.flush({});
  });

  it("does NOT attach Authorization header to the login endpoint", () => {
    setup("my-jwt-token");

    http.post("/api/auth/login", { email: "a@b.com", password: "pw" }).subscribe({
      error: () => {}, // ignore
    });

    const req = httpMock.expectOne("/api/auth/login");
    expect(req.request.headers.has("Authorization")).toBeFalse();
    req.flush({});
  });

  it("does NOT attach Authorization header when no token is stored", () => {
    setup(null);

    http.get("/api/config").subscribe({ error: () => {} });

    const req = httpMock.expectOne("/api/config");
    expect(req.request.headers.has("Authorization")).toBeFalse();
    req.flush({}, { status: 401, statusText: "Unauthorized" });
  });

  // -------------------------------------------------------------------------
  // 401 handling
  // -------------------------------------------------------------------------

  it("calls auth.logout() and navigates to /login on 401 for non-login requests", () => {
    setup("my-jwt-token");

    http.get("/api/config").subscribe({ error: () => {} });

    const req = httpMock.expectOne("/api/config");
    req.flush({ message: "No autorizado." }, { status: 401, statusText: "Unauthorized" });

    expect(fakeAuth.logout).toHaveBeenCalled();
    expect(routerSpy.navigate).toHaveBeenCalledWith(["/login"]);
  });

  it("does NOT call logout or navigate on 401 from the login endpoint", () => {
    setup("my-jwt-token");

    http.post("/api/auth/login", { email: "x@y.com", password: "bad" }).subscribe({ error: () => {} });

    const req = httpMock.expectOne("/api/auth/login");
    req.flush({ message: "Credenciales inválidas." }, { status: 401, statusText: "Unauthorized" });

    expect(fakeAuth.logout).not.toHaveBeenCalled();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // 403 handling — distinct from 401: NOT a session problem, must not log the
  // user out or redirect. The error is re-thrown so the calling component can
  // surface a permission message; the interceptor itself does not swallow it.
  // -------------------------------------------------------------------------

  it("does NOT call logout or navigate on 403 for non-login requests", () => {
    setup("my-jwt-token");

    http.get("/api/admin/offers").subscribe({ error: () => {} });

    const req = httpMock.expectOne("/api/admin/offers");
    req.flush(
      { message: "No tienes permisos de administrador para realizar esta acción." },
      { status: 403, statusText: "Forbidden" }
    );

    expect(fakeAuth.logout).not.toHaveBeenCalled();
    expect(routerSpy.navigate).not.toHaveBeenCalled();
  });

  it("re-throws the error on 403 so the calling component can surface it", () => {
    setup("my-jwt-token");

    let observedError: unknown;
    http.get("/api/admin/offers").subscribe({
      error: (err) => {
        observedError = err;
      },
    });

    const req = httpMock.expectOne("/api/admin/offers");
    req.flush({ message: "Forbidden" }, { status: 403, statusText: "Forbidden" });

    expect(observedError).toBeTruthy();
    expect((observedError as HttpErrorResponse).status).toBe(403);
  });
});
