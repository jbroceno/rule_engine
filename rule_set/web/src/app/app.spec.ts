import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from './services/auth.service';

describe('App', () => {
  let authStub: {
    isAuthenticated: ReturnType<typeof signal<boolean>>;
    isAdmin: ReturnType<typeof signal<boolean>>;
    logout: jasmine.Spy;
  };

  function configure(authenticated: boolean, admin: boolean = true): void {
    authStub = {
      isAuthenticated: signal(authenticated),
      isAdmin: signal(admin),
      logout: jasmine.createSpy('logout')
    };

    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: AuthService, useValue: authStub }]
    });
  }

  it('should create the app', async () => {
    configure(true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    configure(true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Simulador de Ofertas');
  });

  it('shows the nav and logout button when authenticated', async () => {
    configure(true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')).not.toBeNull();
    expect(compiled.querySelector('.logout-button')).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // configurable-auth-modes (PR 2, frontend) — nav is now ALWAYS rendered
  // (read-only links visible to anyone); only the admin links and the
  // login/logout affordance are gated by auth/role state.
  //
  // permissive-config-readonly (PR 2, frontend infra) — ADR-CR6/spec "Nav
  // split — Configurador and Períodos join the always-visible bucket":
  // Configurador and Períodos are no longer admin-only nav links; they are
  // visible to anonymous users too. Ofertas and Snapshots remain admin-only
  // (out of scope, unchanged).
  // -------------------------------------------------------------------------
  it('shows the read-only nav links (including Configurador and Periodos) and a login link (no logout button) when not authenticated', async () => {
    // An anonymous user is never an admin — pass admin: false explicitly
    // rather than relying on the helper's default.
    configure(false, false);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const nav = compiled.querySelector('nav');
    expect(nav).not.toBeNull();

    const navText = nav?.textContent ?? '';
    expect(navText).toContain('Configuracion');
    expect(navText).toContain('Simulador INIT');
    expect(navText).toContain('Simulador PRE');
    expect(navText).toContain('Simulador FINAL');

    // permissive-config-readonly: Configurador and Periodos are now
    // always-visible read-only links, even to an anonymous user.
    expect(navText).toContain('Períodos');
    expect(navText).toContain('Configurador');

    // Ofertas and Snapshots remain admin-only — out of scope, unchanged.
    expect(navText).not.toContain('Ofertas');
    expect(navText).not.toContain('Snapshots');

    expect(compiled.querySelector('.logout-button')).toBeNull();
    expect(compiled.querySelector('a[routerLink="/login"]')).not.toBeNull();
  });

  it('clears the session and navigates to /login on logout click', async () => {
    configure(true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    const navigateSpy = spyOn(TestBed.inject(Router), 'navigate');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('.logout-button') as HTMLButtonElement;
    button.click();
    expect(authStub.logout).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith(['/login']);
  });

  // -------------------------------------------------------------------------
  // T-13c — admin-only nav links hidden for non-admin (UI defense only)
  //
  // permissive-config-readonly: Periodos and Configurador are no longer
  // admin-only — a "viewer" (authenticated, non-admin) now sees them.
  // Ofertas and Snapshots remain hidden — out of scope, unchanged.
  // -------------------------------------------------------------------------
  it('hides admin-only nav links (Ofertas, Snapshots) but shows Periodos/Configurador when isAdmin() is false', async () => {
    configure(true, false);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const navText = compiled.querySelector('nav')?.textContent ?? '';

    expect(navText).not.toContain('Snapshots');
    // Regression check for the pre-existing isAdmin() gating bug: a
    // non-admin authenticated user ("viewer") must NOT see /ofertas either.
    expect(navText).not.toContain('Ofertas');

    // permissive-config-readonly: Periodos and Configurador are now
    // always-visible read-only links, shown to a non-admin viewer too.
    expect(navText).toContain('Períodos');
    expect(navText).toContain('Configurador');

    // Read-only links remain visible, and the authenticated user gets the
    // logout affordance (not the login link).
    expect(navText).toContain('Configuracion');
    expect(navText).toContain('Simulador INIT');
    expect(compiled.querySelector('.logout-button')).not.toBeNull();
    expect(compiled.querySelector('a[routerLink="/login"]')).toBeNull();
  });

  it('shows the complete navigation (including admin-only links) when isAdmin() is true', async () => {
    configure(true, true);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const navText = compiled.querySelector('nav')?.textContent ?? '';

    expect(navText).toContain('Períodos');
    expect(navText).toContain('Configurador');
    expect(navText).toContain('Snapshots');
    expect(navText).toContain('Ofertas');
    expect(navText).toContain('Configuracion');
  });
});
