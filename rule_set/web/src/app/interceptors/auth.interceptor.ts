import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, throwError } from "rxjs";

import { AuthService } from "../services/auth.service";

/**
 * Functional HttpInterceptorFn that:
 * - Attaches Authorization: Bearer <token> to every request except POST /api/auth/login.
 * - On 401 response (except login), calls auth.logout() and redirects to /login —
 *   a 401 means the session itself is invalid/expired.
 * - On 403 response, does NOT log out or redirect — a 403 means the session is
 *   valid but the role lacks permission (e.g. a "viewer" hitting an admin-only
 *   route). The error is re-thrown unchanged so the calling component's own
 *   `error:` handler can surface a permission message (see e.g.
 *   login-page.component.ts's error-handling pattern) instead of the user
 *   being silently kicked back to /login for a problem re-authenticating
 *   would not fix.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Skip token attachment and 401 redirect for the login endpoint itself.
  const isLogin = req.url === "/api/auth/login";
  const token = auth.getToken();

  const authReq =
    !isLogin && token
      ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !isLogin) {
        auth.logout();
        router.navigate(["/login"]);
      } else if (err.status === 403) {
        // Not a session problem — do not log out, do not redirect. Fall
        // through to the re-throw below so the caller can show a message.
      }
      return throwError(() => err);
    }),
  );
};
