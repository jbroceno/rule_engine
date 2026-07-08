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

  // Protected routes — all require authentication.
  { path: 'ofertas',        component: OfertasPageComponent,          canActivate: [authGuard] },
  { path: 'configurador',   component: ConfiguratorPageComponent,      canActivate: [authGuard] },
  { path: 'configuracion',  component: ConfigPageComponent,            canActivate: [authGuard] },
  { path: 'snapshots',      component: SnapshotsPageComponent,         canActivate: [authGuard] },
  { path: 'offer-dates',    component: OfferDatesPageComponent,        canActivate: [authGuard] },
  { path: 'simulador-init', component: InitSimulatorPageComponent,     canActivate: [authGuard] },
  { path: 'simulador-pre',  component: PreSimulatorPageComponent,      canActivate: [authGuard] },
  { path: 'simulador-final',component: FinalSimulatorPageComponent,    canActivate: [authGuard] },

  // Catch-all — redirects to configurador (which then hits authGuard).
  { path: '**', redirectTo: 'configurador' }
];
