import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { AuthService } from './services/auth.service';

describe('App', () => {
  let authStub: { isAuthenticated: ReturnType<typeof signal<boolean>>; logout: jasmine.Spy };

  function configure(authenticated: boolean): void {
    authStub = { isAuthenticated: signal(authenticated), logout: jasmine.createSpy('logout') };

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

  it('hides the nav and logout button when not authenticated', async () => {
    configure(false);
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('nav')).toBeNull();
    expect(compiled.querySelector('.logout-button')).toBeNull();
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
});
