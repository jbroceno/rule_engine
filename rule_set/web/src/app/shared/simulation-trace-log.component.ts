import { CommonModule } from "@angular/common";
import { Component, computed, Input, OnChanges, signal, SimpleChanges } from "@angular/core";

import { ConditionTraceItem, OfferEvaluationResult, RuleTraceItem } from "../models/api.models";

type RuleTraceView = {
  rule: RuleTraceItem;
  conditions: ConditionTraceItem[];
};

type OfferTraceView = {
  offerCode: string;
  eligible: boolean;
  rules: RuleTraceView[];
  dictamen: Array<{ key: string; value: string }>;
  summary: string;
};

@Component({
  selector: "app-simulation-trace-log",
  standalone: true,
  imports: [CommonModule],
  templateUrl: "./simulation-trace-log.component.html",
  styleUrl: "./simulation-trace-log.component.css",
})
export class SimulationTraceLogComponent implements OnChanges {
  @Input({ required: true }) title = "Trazas";
  @Input({ required: true }) evaluations: OfferEvaluationResult[] = [];
  @Input() eligibilityKey: "initEligible" | "preEligible" | "eligible" = "preEligible";

  protected readonly expanded = signal<Set<string>>(new Set<string>());

  protected readonly allExpanded = computed(() => {
    const set = this.expanded();
    return this.evaluations.length > 0 &&
      this.evaluations.every((e) => set.has(e.offerCode));
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes["evaluations"]) {
      this.expanded.set(new Set());
    }
  }

  protected isExpanded(offerCode: string): boolean {
    return this.expanded().has(offerCode);
  }

  protected toggle(offerCode: string): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(offerCode)) {
        next.delete(offerCode);
      } else {
        next.add(offerCode);
      }
      return next;
    });
  }

  protected toggleAll(checked: boolean): void {
    if (checked) {
      this.expanded.set(new Set(this.evaluations.map((e) => e.offerCode)));
    } else {
      this.expanded.set(new Set());
    }
  }

  protected buildViews(): OfferTraceView[] {
    return this.evaluations.map((evaluation) => {
      const ruleTrace = evaluation.trace?.ruleTrace ?? [];
      const condTrace = evaluation.trace?.condTrace ?? [];
      const rules = ruleTrace.map((rule) => ({
        rule,
        conditions: condTrace.filter((condition) => condition.rule_id === rule.rule_id),
      }));

      const dictamenEntries = Object.entries(evaluation.dictamen ?? {})
        .filter(([key]) => key !== "motivos")
        .map(([key, value]) => ({ key, value: this.formatTraceValue(value) }));

      const motivos = evaluation.dictamen?.["motivos"];
      const motivosStr = Array.isArray(motivos)
        ? motivos.map((m: unknown) =>
            m !== null && typeof m === "object" && "code" in (m as object)
              ? (m as { code: string }).code
              : this.formatTraceValue(m)
          ).join(" · ")
        : (motivos ? this.formatTraceValue(motivos) : "");
      const dictamenSummary = dictamenEntries
        .slice(0, 3)
        .map(({ key, value }) => `${key}: ${value}`)
        .join(" · ");
      const summary = [motivosStr, dictamenSummary].filter(Boolean).join(" | ");

      return {
        offerCode: evaluation.offerCode,
        eligible: Boolean(evaluation.dictamen?.[this.eligibilityKey]),
        rules,
        dictamen: dictamenEntries,
        summary,
      };
    });
  }

  protected summarizeCondition(condition: ConditionTraceItem): string {
    const field = condition.field ?? "campo";
    const operator = condition.op ?? "?";
    const group = condition.group_id ?? 0;
    return `Grupo ${group} - ${field} ${operator}`;
  }

  protected formatTraceValue(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map((item) => this.formatTraceValue(item)).join(", ");
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (value === null || value === undefined || value === "") {
      return "-";
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "[objeto]";
      }
    }
    return String(value);
  }

  protected formatExpected(condition: ConditionTraceItem): string {
    const expected = this.formatTraceValue(condition.expected);
    const source = condition.expectedSource;

    if (Array.isArray(source)) {
      const refs = source
        .map((item) => this.formatParamSource(item))
        .filter(Boolean)
        .join(" .. ");
      return refs ? `${expected} (${refs})` : expected;
    }

    const ref = this.formatParamSource(source);
    return ref ? `${expected} (${ref})` : expected;
  }

  private formatParamSource(value: unknown): string {
    const raw = typeof value === "string" ? value.trim() : "";
    return raw.toUpperCase().startsWith("PARAM:") ? raw : "";
  }
}
