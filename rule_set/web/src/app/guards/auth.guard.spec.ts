import { TestBed } from "@angular/core/testing";
import { Router, UrlTree } from "@angular/router";
import { signal } from "@angular/core";

import { authGuard } from "./auth.guard";
import { AuthService } from "../services/auth.service";

// ---------------------------------------------------------------------------
// authGuard unit tests
// ---------------------------------------------------------------------------

describe("authGuard", () => {
  let routerSpy: jasmine.SpyObj<Router>;

  function buildGuard(authenticated: boolean): ReturnType<typeof authGuard> {
    const fakeAuth: Partial<AuthService> = {
      isAuthenticated: signal(authenticated),
    };

    routerSpy = jasmine.createSpyObj<Router>("Router", ["createUrlTree", "navigate"]);
    routerSpy.createUrlTree.and.returnValue({ toString: () => "/login" } as unknown as UrlTree);

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: fakeAuth },
        { provide: Router, useValue: routerSpy },
      ],
    });

    // Run guard inside injection context.
    return TestBed.runInInjectionContext(() =>
      authGuard({} as never, {} as never),
    );
  }

  // -------------------------------------------------------------------------

  it("returns true when the user is authenticated", () => {
    const result = buildGuard(true);
    expect(result).toBeTrue();
  });

  it("returns a UrlTree redirect to /login when the user is not authenticated", () => {
    const result = buildGuard(false);
    expect(routerSpy.createUrlTree).toHaveBeenCalledWith(
      ["/login"],
      jasmine.objectContaining({ queryParams: jasmine.any(Object) }),
    );
    // The result must be a UrlTree, not true.
    expect(result).not.toBeTrue();
  });
});
