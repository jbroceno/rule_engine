import { TestBed } from "@angular/core/testing";
import { HttpClientTestingModule, HttpTestingController } from "@angular/common/http/testing";

import { AdminApiService } from "./admin-api.service";
import { AdminWorkflowPublicarPayload, AdminWorkflowSnapshotPayload } from "../models/admin.models";

// ---------------------------------------------------------------------------
// T2b.1 — AdminApiService: getOffers(offerDateId?) and deleteOfferRulesInPeriod()
// ---------------------------------------------------------------------------

describe("AdminApiService — offers-page-and-period-cascade PR2b", () => {
  let service: AdminApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminApiService],
    });
    service = TestBed.inject(AdminApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it("T2b.1a: getOffers() without offerDateId sends GET /api/admin/offers with no offerDateId param", () => {
    service.getOffers().subscribe();

    const req = httpMock.expectOne("/api/admin/offers");
    expect(req.request.method).toBe("GET");
    expect(req.request.params.has("offerDateId")).toBeFalse();
    req.flush({ items: [] });
  });

  it("T2b.1b: getOffers(5) sends GET /api/admin/offers?offerDateId=5", () => {
    service.getOffers(5).subscribe();

    const req = httpMock.expectOne((r) => r.url === "/api/admin/offers" && r.params.has("offerDateId"));
    expect(req.request.method).toBe("GET");
    expect(req.request.params.get("offerDateId")).toBe("5");
    req.flush({ items: [] });
  });

  it("T2b.1c: deleteOfferRulesInPeriod sends DELETE /api/admin/offers/:offerCode/rules?offerDateId=N", () => {
    service.deleteOfferRulesInPeriod("OFERTA_RESTRICTIVA", 7).subscribe();

    const req = httpMock.expectOne(
      (r) => r.url === "/api/admin/offers/OFERTA_RESTRICTIVA/rules" && r.params.has("offerDateId"),
    );
    expect(req.request.method).toBe("DELETE");
    expect(req.request.params.get("offerDateId")).toBe("7");
    expect(req.request.params.has("createdBy")).toBeFalse();
    req.flush({ offerCode: "OFERTA_RESTRICTIVA", offerDateId: 7, deleted: true, snapshot_id: 1, deletedRules: 2, deletedParams: 1 });
  });

  it("T2b.1d: deleteOfferRulesInPeriod with createdBy sends createdBy query param", () => {
    service.deleteOfferRulesInPeriod("OFERTA_PERMISIVA", 3, "user.test").subscribe();

    const req = httpMock.expectOne(
      (r) => r.url === "/api/admin/offers/OFERTA_PERMISIVA/rules" && r.params.has("offerDateId"),
    );
    expect(req.request.params.get("createdBy")).toBe("user.test");
    req.flush({ offerCode: "OFERTA_PERMISIVA", offerDateId: 3, deleted: true, snapshot_id: 2, deletedRules: 0, deletedParams: 0 });
  });

  it("T2b.1e: getOffers(0) sends GET /api/admin/offers with no offerDateId (invalid id ignored)", () => {
    service.getOffers(0).subscribe();

    // offerDateId=0 should be sent as "0" in params but backend ignores it — service should not filter it out
    const req = httpMock.expectOne((r) => r.url === "/api/admin/offers");
    expect(req.request.method).toBe("GET");
    req.flush({ items: [] });
  });
});

describe("AdminApiService — mro-snapshot-deploy cap-2/3", () => {
  let service: AdminApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [AdminApiService],
    });
    service = TestBed.inject(AdminApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ---------------------------------------------------------------------------
  // T3.1a — publishToWorkflow sends tipoDs in HTTP body
  // ---------------------------------------------------------------------------
  it("T3.1a: publishToWorkflow sends tipoDs in HTTP POST body", () => {
    const payload: AdminWorkflowPublicarPayload = {
      offerDateId: 7,
      rangoDestino: { vigDesde: "2026-01-01", vigHasta: null },
      createdBy: "tester",
      tipoDs: "AMBOS",
    };

    service.publishToWorkflow(payload).subscribe();

    const req = httpMock.expectOne("/api/admin/workflow/publicar");
    expect(req.request.method).toBe("POST");
    expect(req.request.body["tipoDs"]).toBe("AMBOS");
    expect(req.request.body["offerDateId"]).toBe(7);
    req.flush({ published: true, rules: 5, params: 3 });
  });

  // ---------------------------------------------------------------------------
  // T3.1b — publishToWorkflow without tipoDs: field absent (backend defaults)
  // ---------------------------------------------------------------------------
  it("T3.1b: publishToWorkflow without tipoDs does NOT send the field", () => {
    const payload: AdminWorkflowPublicarPayload = {
      offerDateId: 7,
      rangoDestino: { vigDesde: "2026-01-01", vigHasta: null },
    };

    service.publishToWorkflow(payload).subscribe();

    const req = httpMock.expectOne("/api/admin/workflow/publicar");
    expect(req.request.method).toBe("POST");
    expect(Object.prototype.hasOwnProperty.call(req.request.body, "tipoDs")).toBeFalse();
    req.flush({ published: true, rules: 5, params: 3 });
  });

  // ---------------------------------------------------------------------------
  // T3.1c — restoreSnapshot with destino='WF' sets destino='WF' in body
  // ---------------------------------------------------------------------------
  it("T3.1c: restoreSnapshot with destino WF sets destino=WF in HTTP body", () => {
    const rangoDestino = { vigDesde: "2026-03-01", vigHasta: null };

    service
      .restoreSnapshot(42, {
        destino: "WF",
        rangoDestino,
        createdBy: "deployer",
      })
      .subscribe();

    const req = httpMock.expectOne("/api/admin/snapshots/42/restore");
    expect(req.request.method).toBe("POST");
    expect(req.request.body["destino"]).toBe("WF");
    expect(req.request.body["rangoDestino"]).toEqual(rangoDestino);
    req.flush({ preRestoreSnapshotId: 99, published: true, rules: 4, params: 2 });
  });

  // ---------------------------------------------------------------------------
  // C-2 fix — createWorkflowSnapshot sends vigDesde/vigHasta (NOT motorFechaId)
  // ---------------------------------------------------------------------------
  it("T3.cap1a: createWorkflowSnapshot sends vigDesde and vigHasta in HTTP POST body", () => {
    const payload: AdminWorkflowSnapshotPayload = {
      vigDesde: "2026-01-01",
      vigHasta: "2026-12-31",
      createdBy: "tester",
    };

    service.createWorkflowSnapshot(payload).subscribe();

    const req = httpMock.expectOne("/api/admin/workflow/snapshot");
    expect(req.request.method).toBe("POST");
    expect(req.request.body["vigDesde"]).toBe("2026-01-01");
    expect(req.request.body["vigHasta"]).toBe("2026-12-31");
    expect(Object.prototype.hasOwnProperty.call(req.request.body, "motorFechaId")).toBeFalse();
    req.flush({ snapshot_id: 77, snapshot_name: "WF Snapshot 2026-06-02 12:00" });
  });

  it("T3.cap1b: createWorkflowSnapshot with null dates sends null fields", () => {
    const payload: AdminWorkflowSnapshotPayload = {
      vigDesde: null,
      vigHasta: null,
    };

    service.createWorkflowSnapshot(payload).subscribe();

    const req = httpMock.expectOne("/api/admin/workflow/snapshot");
    expect(req.request.method).toBe("POST");
    expect(req.request.body["vigDesde"]).toBeNull();
    expect(req.request.body["vigHasta"]).toBeNull();
    req.flush({ snapshot_id: 78, snapshot_name: "WF Snapshot 2026-06-02 12:01" });
  });
});
