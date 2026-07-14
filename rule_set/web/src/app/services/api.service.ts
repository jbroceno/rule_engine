import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { Observable, catchError, throwError } from "rxjs";

import {
  ConfigResponse,
  FinalSimulationEnvelope,
  FinalSimulationRequest,
  FinalSimulationResponse,
  InitEligibleOffer,
  InitSimulationRequest,
  InitSimulationResponse,
  PreEligibleOffer,
  PreSimulationEnvelope,
  PreSimulationRequest,
  PreSimulationResponse,
} from "../models/api.models";

/**
 * Fix (code review follow-up, 2026-07-15): a plain `Error` thrown by
 * `handleError` used to carry ONLY the server's translated message,
 * discarding `HttpErrorResponse.status` entirely — callers that need to
 * distinguish a specific HTTP status (e.g. 401, already handled end-to-end
 * by `authInterceptor`'s logout+redirect) had no way to do so without
 * regex-matching message text. Mirrors `AdminApiError`
 * (admin-api.service.ts, code review PR3 2026-07-14) for this service.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

@Injectable({ providedIn: "root" })
export class ApiService {
  private readonly baseUrl = "/api";

  constructor(private readonly http: HttpClient) {}

  health(): Observable<{ status: string }> {
    return this.http.get<{ status: string }>(`${this.baseUrl}/health`).pipe(catchError((error) => this.handleError(error)));
  }

  getConfig(): Observable<ConfigResponse> {
    return this.http.get<ConfigResponse>(`${this.baseUrl}/config`).pipe(catchError((error) => this.handleError(error)));
  }

  simulateInit(payload: InitSimulationRequest): Observable<InitSimulationResponse> {
    return this.http
      .post<InitSimulationResponse>(`${this.baseUrl}/simulate/init`, { ...payload, debug: true })
      .pipe(catchError((error) => this.handleError(error)));
  }

  extractInitEligibleOffers(response: InitSimulationResponse | null): InitEligibleOffer[] {
    return response?.eligibleOffers ?? [];
  }

  simulatePre(payload: PreSimulationRequest): Observable<PreSimulationEnvelope> {
    return this.http
      .post<PreSimulationEnvelope>(`${this.baseUrl}/simulate/pre`, { ...payload, debug: true })
      .pipe(catchError((error) => this.handleError(error)));
  }

  simulateFinal(payload: FinalSimulationRequest): Observable<FinalSimulationEnvelope> {
    return this.http
      .post<FinalSimulationEnvelope>(`${this.baseUrl}/simulate/final`, { ...payload, debug: true })
      .pipe(catchError((error) => this.handleError(error)));
  }

  extractPreEligibleOffers(response: PreSimulationResponse | null): PreEligibleOffer[] {
    if (!response) {
      return [];
    }
    if (Array.isArray(response.preElegibles)) {
      return response.preElegibles;
    }
    if (Array.isArray(response.eligibleOffers)) {
      return response.eligibleOffers;
    }
    return [];
  }

  private handleError(error: HttpErrorResponse) {
    const message = this.extractErrorMessage(error);
    return throwError(() => new ApiError(message, error.status));
  }

  private extractErrorMessage(error: HttpErrorResponse): string {
    const serverBody = error.error;
    if (typeof serverBody === "string" && serverBody.trim()) {
      return serverBody;
    }
    if (serverBody && typeof serverBody === "object") {
      const candidate = (serverBody as Record<string, unknown>)["message"];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
      const genericError = (serverBody as Record<string, unknown>)["error"];
      if (typeof genericError === "string" && genericError.trim()) {
        return genericError;
      }
    }
    return error.message || "Error inesperado de red.";
  }
}
