import { HttpClient, HttpErrorResponse, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, catchError, throwError } from "rxjs";

import {
  AdminConfigApplyPayload,
  AdminConfigApplyPreviewPayload,
  AdminConfigApplyResponse,
  AdminConfigExport,
  ApplyImpact,
  AdminResetSeedPayload,
  AdminResetSeedResponse,
  AdminOffer,
  AdminOfferCreateResponse,
  AdminOfferDeleteResponse,
  AdminOfferEnabledResponse,
  AdminOffersResponse,
  AdminOfferRulesDeleteResponse,
  AdminOfferUpdatePayload,
  AdminOfferUpdateResponse,
  AdminOfferPayload,
  AdminSnapshotListQuery,
  AdminSnapshotListResponse,
  AdminSnapshotRestoreResponse,
  AdminSnapshotDeleteResponse,
  AdminParamDeleteResponse,
  AdminParamIdResponse,
  AdminParamPayload,
  AdminParamsQuery,
  AdminParamsResponse,
  AdminParamUpdatePayload,
  AdminParamUpdateResponse,
  AdminRuleDeleteResponse,
  AdminRuleEnabledResponse,
  AdminRuleIdResponse,
  AdminRulePayload,
  AdminRuleReorderPayload,
  AdminRuleReorderResponse,
  AdminRulesQuery,
  AdminRulesResponse,
  AdminRuleUpdateResponse,
  ValidatePayloadRequest,
  ValidatePayloadResponse,
  AdminFechaPayload,
  AdminFechasResponse,
  AdminFechaCreateResponse,
  AdminFechaUpdateResponse,
  AdminFechaDeleteResponse,
  AdminPocSnapshotPayload,
  AdminPocSnapshotResponse,
  AdminWorkflowSnapshotPayload,
  AdminWorkflowSnapshotResponse,
  AdminWorkflowPublicarPayload,
  AdminWorkflowPublicarResponse,
  AdminSnapshotContentResponse,
} from "../models/admin.models";

@Injectable({ providedIn: "root" })
export class AdminApiService {
  private readonly baseUrl = "/api/admin";

  constructor(private readonly http: HttpClient) {}

  getOffers(offerDateId?: number): Observable<AdminOffersResponse> {
    const params =
      offerDateId !== undefined
        ? this.buildQueryParams({ offerDateId })
        : undefined;
    return this.http
      .get<AdminOffersResponse>(`${this.baseUrl}/offers`, { params })
      .pipe(catchError((error) => this.handleError(error)));
  }

  deleteOfferRulesInPeriod(
    offerCode: string,
    offerDateId: number,
    createdBy?: string,
  ): Observable<AdminOfferRulesDeleteResponse> {
    const params = this.buildQueryParams({
      offerDateId,
      ...(createdBy?.trim() ? { createdBy: createdBy.trim() } : {}),
    });
    return this.http
      .delete<AdminOfferRulesDeleteResponse>(
        `${this.baseUrl}/offers/${encodeURIComponent(offerCode)}/rules`,
        { params },
      )
      .pipe(catchError((error) => this.handleError(error)));
  }

  createOffer(payload: AdminOfferPayload): Observable<AdminOfferCreateResponse> {
    return this.http
      .post<AdminOfferCreateResponse>(`${this.baseUrl}/offers`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  updateOffer(offerCode: string, payload: AdminOfferUpdatePayload): Observable<AdminOfferUpdateResponse> {
    return this.http
      .put<AdminOfferUpdateResponse>(`${this.baseUrl}/offers/${encodeURIComponent(offerCode)}`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  deleteOffer(offerCode: string, createdBy?: string): Observable<AdminOfferDeleteResponse> {
    const params = createdBy?.trim()
      ? new HttpParams().set("createdBy", createdBy.trim())
      : undefined;
    return this.http
      .delete<AdminOfferDeleteResponse>(`${this.baseUrl}/offers/${encodeURIComponent(offerCode)}`, { params })
      .pipe(catchError((error) => this.handleError(error)));
  }

  setOfferEnabled(offerCode: string, enabled: boolean): Observable<AdminOfferEnabledResponse> {
    return this.http
      .patch<AdminOfferEnabledResponse>(`${this.baseUrl}/offers/${encodeURIComponent(offerCode)}/enabled`, { enabled })
      .pipe(catchError((error) => this.handleError(error)));
  }

  getRules(query: AdminRulesQuery): Observable<AdminRulesResponse> {
    const params = this.buildQueryParams({
      offerCode: query.offerCode,
      stage: query.stage,
      q: query.q,
      offerDateId: query.offerDateId,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 100,
    });

    return this.http
      .get<AdminRulesResponse>(`${this.baseUrl}/rules`, { params })
      .pipe(catchError((error) => this.handleError(error)));
  }

  getParams(query: AdminParamsQuery): Observable<AdminParamsResponse> {
    const params = this.buildQueryParams({
      offerCode: query.offerCode,
      offerDateId: query.offerDateId,
    });

    return this.http
      .get<AdminParamsResponse>(`${this.baseUrl}/params`, { params })
      .pipe(catchError((error) => this.handleError(error)));
  }

  validateRulePayload(payload: ValidatePayloadRequest): Observable<ValidatePayloadResponse> {
    return this.http
      .post<ValidatePayloadResponse>(`${this.baseUrl}/validate`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  createRule(payload: AdminRulePayload): Observable<AdminRuleIdResponse> {
    return this.http
      .post<AdminRuleIdResponse>(`${this.baseUrl}/rules`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  updateRule(ruleId: number, payload: AdminRulePayload): Observable<AdminRuleUpdateResponse> {
    return this.http
      .put<AdminRuleUpdateResponse>(`${this.baseUrl}/rules/${ruleId}`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  deleteRule(ruleId: number): Observable<AdminRuleDeleteResponse> {
    return this.http
      .delete<AdminRuleDeleteResponse>(`${this.baseUrl}/rules/${ruleId}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  setRuleEnabled(ruleId: number, enabled: boolean): Observable<AdminRuleEnabledResponse> {
    return this.http
      .patch<AdminRuleEnabledResponse>(`${this.baseUrl}/rules/${ruleId}/enabled`, { enabled })
      .pipe(catchError((error) => this.handleError(error)));
  }

  reorderRules(payload: AdminRuleReorderPayload): Observable<AdminRuleReorderResponse> {
    return this.http
      .patch<AdminRuleReorderResponse>(`${this.baseUrl}/rules/reorder`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  createParam(payload: AdminParamPayload): Observable<AdminParamIdResponse> {
    return this.http
      .post<AdminParamIdResponse>(`${this.baseUrl}/params`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  updateParam(paramId: number, payload: AdminParamUpdatePayload): Observable<AdminParamUpdateResponse> {
    return this.http
      .put<AdminParamUpdateResponse>(`${this.baseUrl}/params/${paramId}`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  deleteParam(paramId: number): Observable<AdminParamDeleteResponse> {
    return this.http
      .delete<AdminParamDeleteResponse>(`${this.baseUrl}/params/${paramId}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  exportConfig(): Observable<AdminConfigExport> {
    return this.http
      .get<AdminConfigExport>(`${this.baseUrl}/export`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  applyConfig(payload: AdminConfigApplyPayload): Observable<AdminConfigApplyResponse> {
    return this.http
      .post<AdminConfigApplyResponse>(`${this.baseUrl}/config/apply`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  /** Read-only preview of what applyConfig(...) would delete/insert — no comment/confirmReplaceAll required. */
  previewApply(payload: AdminConfigApplyPreviewPayload): Observable<ApplyImpact> {
    return this.http
      .post<ApplyImpact>(`${this.baseUrl}/config/apply/preview`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  resetSeed(payload: AdminResetSeedPayload): Observable<AdminResetSeedResponse> {
    return this.http
      .post<AdminResetSeedResponse>(`${this.baseUrl}/config/reset-seed`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  listSnapshots(query: AdminSnapshotListQuery): Observable<AdminSnapshotListResponse> {
    const params = this.buildQueryParams({
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      q: query.q,
      entorno: query.entorno,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
    return this.http
      .get<AdminSnapshotListResponse>(`${this.baseUrl}/snapshots`, { params })
      .pipe(catchError((error) => this.handleError(error)));
  }

  restoreSnapshot(
    snapshotId: number,
    options?: { createdBy?: string; destino?: "POC" | "WF"; rangoDestino?: { vigDesde: string; vigHasta: string | null }; ofertaIdOverrides?: Record<string, number>; pocFechaDesde?: string },
  ): Observable<AdminSnapshotRestoreResponse> {
    return this.http
      .post<AdminSnapshotRestoreResponse>(`${this.baseUrl}/snapshots/${snapshotId}/restore`, {
        createdBy: options?.createdBy ?? null,
        destino: options?.destino ?? "POC",
        rangoDestino: options?.rangoDestino ?? null,
        ofertaIdOverrides: options?.ofertaIdOverrides,
        pocFechaDesde: options?.pocFechaDesde ?? null,
      })
      .pipe(catchError((error) => this.handleError(error)));
  }

  deleteSnapshot(snapshotId: number): Observable<AdminSnapshotDeleteResponse> {
    return this.http
      .delete<AdminSnapshotDeleteResponse>(`${this.baseUrl}/snapshots/${snapshotId}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  getSnapshotContent(snapshotId: number): Observable<AdminSnapshotContentResponse> {
    return this.http
      .get<AdminSnapshotContentResponse>(`${this.baseUrl}/snapshots/${snapshotId}/content`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  getFechas(): Observable<AdminFechasResponse> {
    return this.http
      .get<AdminFechasResponse>(`${this.baseUrl}/fechas`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  createFecha(payload: AdminFechaPayload): Observable<AdminFechaCreateResponse> {
    return this.http
      .post<AdminFechaCreateResponse>(`${this.baseUrl}/fechas`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  updateFecha(id: number, payload: AdminFechaPayload): Observable<AdminFechaUpdateResponse> {
    return this.http
      .put<AdminFechaUpdateResponse>(`${this.baseUrl}/fechas/${id}`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  deleteFecha(id: number): Observable<AdminFechaDeleteResponse> {
    return this.http
      .delete<AdminFechaDeleteResponse>(`${this.baseUrl}/fechas/${id}`)
      .pipe(catchError((error) => this.handleError(error)));
  }

  duplicateFecha(sourceId: number, validFrom: string): Observable<AdminFechaCreateResponse> {
    return this.http
      .post<AdminFechaCreateResponse>(`${this.baseUrl}/fechas/${sourceId}/duplicate`, { valid_from: validFrom })
      .pipe(catchError((error) => this.handleError(error)));
  }

  createPocSnapshot(payload: AdminPocSnapshotPayload): Observable<AdminPocSnapshotResponse> {
    return this.http
      .post<AdminPocSnapshotResponse>(`${this.baseUrl}/snapshots`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  createWorkflowSnapshot(payload: AdminWorkflowSnapshotPayload): Observable<AdminWorkflowSnapshotResponse> {
    return this.http
      .post<AdminWorkflowSnapshotResponse>(`${this.baseUrl}/workflow/snapshot`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  publishToWorkflow(payload: AdminWorkflowPublicarPayload): Observable<AdminWorkflowPublicarResponse> {
    return this.http
      .post<AdminWorkflowPublicarResponse>(`${this.baseUrl}/workflow/publicar`, payload)
      .pipe(catchError((error) => this.handleError(error)));
  }

  private buildQueryParams(values: Record<string, string | number | undefined>): HttpParams {
    return Object.entries(values).reduce((params, [key, value]) => {
      if (value === undefined) {
        return params;
      }
      if (typeof value === "string") {
        const normalized = value.trim();
        if (!normalized) {
          return params;
        }
        return params.set(key, normalized);
      }
      return params.set(key, String(value));
    }, new HttpParams());
  }

  private handleError(error: HttpErrorResponse) {
    const message = this.extractErrorMessage(error);
    return throwError(() => new Error(message));
  }

  private extractErrorMessage(error: HttpErrorResponse): string {
    const serverBody = error.error;
    if (typeof serverBody === "string" && serverBody.trim()) {
      return serverBody;
    }
    if (serverBody && typeof serverBody === "object") {
      const payload = serverBody as Record<string, unknown>;
      const candidate = payload["message"];
      if (typeof candidate === "string" && candidate.trim()) {
        const details = payload["details"] as Record<string, unknown> | undefined;
        const detailErrors = Array.isArray(details?.["errors"])
          ? (details?.["errors"] as Array<{ field?: unknown; message?: unknown }>)
              .map((item) => `${String(item.field ?? "?")}: ${String(item.message ?? "")}`)
              .join(" | ")
          : "";
        const detailCause = typeof details?.["cause"] === "string" ? String(details["cause"]) : "";

        if (detailErrors) {
          return `${candidate} ${detailErrors}`;
        }
        if (detailCause) {
          return `${candidate} ${detailCause}`;
        }
        return candidate;
      }
      const genericError = payload["error"];
      if (typeof genericError === "string" && genericError.trim()) {
        return genericError;
      }
    }
    return error.message || "Error inesperado de red.";
  }
}
