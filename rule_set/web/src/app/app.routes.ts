import { Routes } from '@angular/router';
import { ConfigPageComponent } from './pages/config-page.component';
import { ConfiguratorPageComponent } from './pages/configurator-page.component';
import { FinalSimulatorPageComponent } from './pages/final-simulator-page.component';
import { InitSimulatorPageComponent } from './pages/init-simulator-page.component';
import { LoginPageComponent } from './pages/login-page.component';
import { OfertasPageComponent } from './pages/ofertas-page.component';
import { OfferDatesPageComponent } from './pages/offer-dates-page.component';
import { PreSimulatorPageComponent } from './pages/pre-simulator-page.component';
import { SnapshotsPageComponent } from './pages/snapshots-page.component';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  // Public — no guard.
  { path: 'login', component: LoginPageComponent },

  // Redirects — these resolve to a guarded route, which triggers authGuard.
  { path: '', pathMatch: 'full', redirectTo: 'offer-dates' },

  // Admin routes — always require authentication, in both auth modes
  // (backed up server-side by requireRole("admin") regardless).
  { path: 'ofertas',        component: OfertasPageComponent,          canActivate: [authGuard] },
  { path: 'snapshots',      component: SnapshotsPageComponent,         canActivate: [authGuard] },

  // Read-only routes — no client-side guard. Anonymous access is allowed
  // when the backend runs AUTH_MODE=permissive; when the backend runs in
  // (default) secure mode, the page's data call 401s and the existing
  // authInterceptor logs out + redirects to /login. No mode-discovery
  // endpoint is used — the backend is the single source of truth.
  //
  // permissive-config-readonly (ADR-CR4): configurador and offer-dates moved
  // here from the admin bucket above. Write actions inside configurador are
  // now template-gated too (PR 3, @if(authService.isAdmin()) in
  // configurator-page.component.html). Write actions inside offer-dates are
  // NOT YET template-gated (tracked for PR 4) — they remain backend-enforced
  // via requireRole("admin") on /api/admin/* in the meantime. This route
  // guard removal only affects reachability of the read-only page shell.
  { path: 'configurador',   component: ConfiguratorPageComponent },
  { path: 'offer-dates',    component: OfferDatesPageComponent },
  { path: 'configuracion',  component: ConfigPageComponent },
  { path: 'simulador-init', component: InitSimulatorPageComponent },
  { path: 'simulador-pre',  component: PreSimulatorPageComponent },
  { path: 'simulador-final',component: FinalSimulatorPageComponent },

  // Catch-all — redirects to the read-only configuracion page, which degrades
  // gracefully for anonymous users in permissive mode instead of bouncing to
  // /login.
  { path: '**', redirectTo: 'configuracion' }
];
