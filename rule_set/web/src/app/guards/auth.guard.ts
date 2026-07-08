import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";

import { AuthService } from "../services/auth.service";

/**
 * Functional CanActivateFn.
 * Returns true when the user is authenticated; otherwise returns a UrlTree
 * redirect to /login (Angular-idiomatic; avoids imperative navigate inside guard).
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated()
    ? true
    : router.createUrlTree(["/login"], { queryParams: { returnUrl: state.url } });
};
