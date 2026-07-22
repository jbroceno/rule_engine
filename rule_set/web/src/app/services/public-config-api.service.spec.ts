import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";

import { PublicConfigApiError, PublicConfigApiService } from "./public-config-api.service";
import { AdminRulesQuery, AdminParamsQuery } from "../models/admin.models";

// ---------------------------------------------------------------------------
// permissive-config-readonly (PR 2, frontend infra) — RED-first spec for the
// new public-adjacent read-only service. Mirrors AdminApiService's read
// methods (getRules/getParams/getOffers/getFechas) but hits the new
// `/api/config/*` surface (backend PR 1) instead of `/api/admin/*`, so
// anonymous/viewer sessions can read config data without a JWT in
// AUTH_MODE=permissive. See design.md ADR-CR5.
// ---------------------------------------------------------------------------

describe("PublicConfigApiService", () => {
  let service: PublicConfigApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [PublicConfigApiService],
    });
    service = TestBed.inject(PublicConfigApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("getRules() sends GET /api/config/rules with query params passed through", () => {
    const query: AdminRulesQuery = { offerCode: "OFERTA_A", stage: "PRE", q: "texto", offerDateId: 7, page: 2, pageSize: 50 };
    service.getRules(query).subscribe();

    const req = httpMock.expectOne((r) => r.url === "/api/config/rules");
    expect(req.request.method).toBe("GET");
    expect(req.request.params.get("offerCode")).toBe("OFERTA_A");
    expect(req.request.params.get("stage")).toBe("PRE");
    expect(req.request.params.get("q")).toBe("texto");
    expect(req.request.params.get("offerDateId")).toBe("7");
    expect(req.request.params.get("page")).toBe("2");
    expect(req.request.params.get("pageSize")).toBe("50");
    req.flush({ items: [], total: 0, page: 2, pageSize: 50 });
  });

  it("getRules() defaults page/pageSize when omitted", () => {
    const query: AdminRulesQuery = {};
    service.getRules(query).subscribe();

    const req = httpMock.expectOne((r) => r.url === "/api/config/rules");
    expect(req.request.params.get("page")).toBe("1");
    expect(req.request.params.get("pageSize")).toBe("100");
    req.flush({ items: [], total: 0, page: 1, pageSize: 100 });
  });

  it("getParams() sends GET /api/config/params with offerCode/offerDateId passthrough", () => {
    const query: AdminParamsQuery = { offerCode: "OFERTA_B", offerDateId: 3 };
    service.getParams(query).subscribe();

    const req = httpMock.expectOne((r) => r.url === "/api/config/params");
    expect(req.request.method).toBe("GET");
    expect(req.request.params.get("offerCode")).toBe("OFERTA_B");
    expect(req.request.params.get("offerDateId")).toBe("3");
    req.flush({ items: [] });
  });

  it("getOffers() without offerDateId sends GET /api/config/offers with no offerDateId param", () => {
    service.getOffers().subscribe();

    const req = httpMock.expectOne("/api/config/offers");
    expect(req.request.method).toBe("GET");
    expect(req.request.params.has("offerDateId")).toBeFalse();
    req.flush({ items: [] });
  });

  it("getOffers(5) sends GET /api/config/offers?offerDateId=5", () => {
    service.getOffers(5).subscribe();

    const req = httpMock.expectOne((r) => r.url === "/api/config/offers" && r.params.has("offerDateId"));
    expect(req.request.method).toBe("GET");
    expect(req.request.params.get("offerDateId")).toBe("5");
    req.flush({ items: [] });
  });

  it("getFechas() sends GET /api/config/fechas with no params", () => {
    service.getFechas().subscribe();

    const req = httpMock.expectOne("/api/config/fechas");
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
  });

  it("wraps a failed request into a PublicConfigApiError preserving the HTTP status", () => {
    let captured: PublicConfigApiError | undefined;
    service.getRules({}).subscribe({
      error: (err: PublicConfigApiError) => (captured = err),
    });

    const req = httpMock.expectOne((r) => r.url === "/api/config/rules");
    req.flush({ message: "No autorizado." }, { status: 401, statusText: "Unauthorized" });

    expect(captured).toBeDefined();
    expect(captured?.status).toBe(401);
    expect(captured?.message).toBe("No autorizado.");
  });
});
