import { CommonModule } from "@angular/common";
import { Component, OnInit, computed, signal } from "@angular/core";

import { ConfigResponse } from "../models/api.models";
import { ApiError, ApiService } from "../services/api.service";

@Component({
  selector: "app-config-page",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./config-page.component.html",
  styleUrl: "./config-page.component.css",
})
export class ConfigPageComponent implements OnInit {
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly config = signal<ConfigResponse | null>(null);

  protected readonly offerCount = computed(() => this.config()?.offers.length ?? 0);
  protected readonly ruleCount = computed(() =>
    (this.config()?.offers ?? []).reduce((total, offer) => total + (offer.rules?.length ?? 0), 0)
  );
  protected readonly paramCount = computed(() =>
    (this.config()?.params ?? []).reduce((total, row) => total + row.paramValues.length, 0)
  );

  constructor(private readonly apiService: ApiService) {}

  ngOnInit(): void {
    this.loadConfig();
  }

  protected loadConfig(): void {
    this.loading.set(true);
    this.error.set(null);

    this.apiService.getConfig().subscribe({
      next: (response) => {
        this.config.set(response);
        this.loading.set(false);
      },
      error: (error: ApiError) => {
        // Fix (code review follow-up, 2026-07-15): a 401 here is already
        // handled end-to-end by authInterceptor (logout + redirect to
        // /login) — setting the local error banner too would race the
        // async redirect and could flash a stale error message on screen.
        // Any other error status still surfaces normally.
        if (error.status !== 401) {
          this.error.set(error.message);
        }
        this.loading.set(false);
      },
    });
  }
}
