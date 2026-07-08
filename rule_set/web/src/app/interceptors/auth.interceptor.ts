import { HttpErrorResponse, HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { Router } from "@angular/router";
import { catchError, throwError } from "rxjs";

import { AuthService } from "../services/auth.service";

/**
 * Functional HttpInterceptorFn that:
 * - Attaches Authorization: Bearer <token> to every request except POST /api/auth/login.
 * - On 401 response (except login), calls auth.logout() and redirects to /login.
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
      }
      return throwError(() => err);
    }),
  );
};
