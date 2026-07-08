import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { ActivePeriodService } from './services/active-period.service';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet, DatePipe],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly analyticMode = signal(false);
  readonly activePeriodService = inject(ActivePeriodService);

  toggleAnalyticMode(): void {
    this.analyticMode.update((current) => !current);
  }
}
