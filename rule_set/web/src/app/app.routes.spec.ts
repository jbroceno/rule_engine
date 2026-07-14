import { routes } from "./app.routes";
import { authGuard } from "./guards/auth.guard";

// ---------------------------------------------------------------------------
// Route-configuration tests — configurable-auth-modes (PR 2, frontend).
//
// Per design ADR-D4: read-only routes (simulators + /configuracion) must NOT
// carry canActivate: [authGuard] so anonymous users can reach them (the
// backend enforces auth in "secure" mode via 401 + authInterceptor). Admin
// routes must always keep the guard, in both auth modes.
// ---------------------------------------------------------------------------

describe("routes", () => {
  function findRoute(path: string) {
    const route = routes.find((r) => r.path === path);
    if (!route) {
      throw new Error(`Route with path "${path}" not found`);
    }
    return route;
  }

  describe("read-only routes have no canActivate guard", () => {
    const readOnlyPaths = ["configuracion", "simulador-init", "simulador-pre", "simulador-final"];

    for (const path of readOnlyPaths) {
      it(`"${path}" has no canActivate`, () => {
        const route = findRoute(path);
        expect(route.canActivate).toBeUndefined();
      });
    }
  });

  describe("admin routes keep the authGuard in both modes", () => {
    const adminPaths = ["ofertas", "configurador", "snapshots", "offer-dates"];

    for (const path of adminPaths) {
      it(`"${path}" has canActivate: [authGuard]`, () => {
        const route = findRoute(path);
        expect(route.canActivate).toEqual([authGuard]);
      });
    }
  });

  it("retargets the catch-all wildcard route to 'configuracion'", () => {
    const wildcard = routes.find((r) => r.path === "**");
    expect(wildcard).toBeDefined();
    expect(wildcard?.redirectTo).toBe("configuracion");
  });

  it("keeps the empty-path redirect pointing at 'offer-dates'", () => {
    const empty = routes.find((r) => r.path === "");
    expect(empty).toBeDefined();
    expect(empty?.redirectTo).toBe("offer-dates");
  });
});
