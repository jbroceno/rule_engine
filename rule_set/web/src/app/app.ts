import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ActivePeriodService } from './services/active-period.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly activePeriodService = inject(ActivePeriodService);
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  logout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
