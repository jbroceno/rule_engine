import { HttpClient, HttpErrorResponse, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, catchError, throwError } from "rxjs";

import {
  AdminFechasResponse,
  AdminOffersResponse,
  AdminParamsQuery,
  AdminParamsResponse,
  AdminRulesQuery,
  AdminRulesResponse,
} from "../models/admin.models";

/**
 * permissive-config-readonly (design ADR-CR5) — read-only counterpart to
 * AdminApiService, hitting the new public-adjacent `/api/config/*` surface
 * (built in backend PR 1) instead of `/api/admin/*`. Reused uniformly by ALL
 * roles (admin, viewer, anonymous) — this is NOT branched on isAdmin(); only
 * the base URL differs from AdminApiService, response shapes are identical
 * since both surfaces are backed by the same controllers. Every WRITE call
 * stays on AdminApiService — this service exposes reads only.
 */
export class PublicConfigApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PublicConfigApiError";
  }
}

@Injectable({ providedIn: "root" })
export class PublicConfigApiService {
  private readonly baseUrl = "/api/config";

  constructor(private readonly http: HttpClient) {}

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

  getOffers(offerDateId?: number): Observable<AdminOffersResponse> {
    const params =
      offerDateId !== undefined
        ? this.buildQueryParams({ offerDateId })
        : undefined;
    return this.http
      .get<AdminOffersResponse>(`${this.baseUrl}/offers`, { params })
      .pipe(catchError((error) => this.handleError(error)));
  }

  getFechas(): Observable<AdminFechasResponse> {
    return this.http
      .get<AdminFechasResponse>(`${this.baseUrl}/fechas`)
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
    return throwError(() => new PublicConfigApiError(message, error.status));
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
