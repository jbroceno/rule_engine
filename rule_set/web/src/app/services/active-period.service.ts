import { Injectable, signal } from "@angular/core";

import { AdminFechaItem } from "../models/admin.models";

const LS_KEY_RULES = "activePeriod.rules";
const LS_KEY_PARAMS = "activePeriod.params";

@Injectable({ providedIn: "root" })
export class ActivePeriodService {
  readonly activePeriodRules = signal<AdminFechaItem | null>(this.loadFromStorage(LS_KEY_RULES));
  readonly activePeriodParams = signal<AdminFechaItem | null>(this.loadFromStorage(LS_KEY_PARAMS));

  setRulesPeriod(period: AdminFechaItem | null): void {
    this.activePeriodRules.set(period);
    this.saveToStorage(LS_KEY_RULES, period);
  }

  setParamsPeriod(period: AdminFechaItem | null): void {
    this.activePeriodParams.set(period);
    this.saveToStorage(LS_KEY_PARAMS, period);
  }

  private loadFromStorage(key: string): AdminFechaItem | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as AdminFechaItem) : null;
    } catch {
      return null;
    }
  }

  private saveToStorage(key: string, value: AdminFechaItem | null): void {
    try {
      if (value) {
        localStorage.setItem(key, JSON.stringify(value));
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Best-effort.
    }
  }
}
