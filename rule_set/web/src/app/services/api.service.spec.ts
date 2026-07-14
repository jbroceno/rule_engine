import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";

import { ApiError, ApiService } from "./api.service";

// ---------------------------------------------------------------------------
// Fix (code review follow-up, 2026-07-15): handleError used to discard the
// real HTTP status, throwing a plain `Error` with only the translated
// message. Read-only page components (config-page, the 3 simulator pages)
// need the status to distinguish a 401 (already handled end-to-end by
// authInterceptor's logout+redirect) from any other failure, without racing
// the async redirect with a locally-rendered error banner. Mirrors
// `AdminApiError` (admin-api.service.ts, code review PR3 2026-07-14) for the
// plain simulate/config API surface.
// ---------------------------------------------------------------------------

describe("ApiService — handleError propagates HTTP status (fix, code review follow-up 2026-07-15)", () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("getConfig() on a 401 response rethrows an ApiError carrying status:401", (done) => {
    service.getConfig().subscribe({
      next: () => fail("expected an error, got a success response"),
      error: (err: ApiError) => {
        expect(err instanceof ApiError).toBeTrue();
        expect(err.status).toBe(401);
        done();
      },
    });

    const req = httpMock.expectOne("/api/config");
    req.flush({ message: "No autorizado." }, { status: 401, statusText: "Unauthorized" });
  });

  it("getConfig() on a 500 response carries status:500 (not confused with the 401 case)", (done) => {
    service.getConfig().subscribe({
      next: () => fail("expected an error, got a success response"),
      error: (err: ApiError) => {
        expect(err.status).toBe(500);
        expect(err.message).toBe("Error interno.");
        done();
      },
    });

    const req = httpMock.expectOne("/api/config");
    req.flush({ message: "Error interno." }, { status: 500, statusText: "Internal Server Error" });
  });
});
