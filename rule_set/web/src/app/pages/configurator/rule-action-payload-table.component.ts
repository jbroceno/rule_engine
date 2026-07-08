import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { RuleActionPayloadEntry } from "../../models/admin.models";
import { VALUE_TYPE_OPTIONS, normalizeValueType } from "../../shared/rule-catalogs";

@Component({
  selector: "app-rule-action-payload-table",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./rule-action-payload-table.component.html",
  styleUrl: "./rule-action-payload-table.component.css",
})
export class RuleActionPayloadTableComponent {
  @Input({ required: true }) entries: RuleActionPayloadEntry[] = [];
  @Input() keyOptions: readonly string[] = [];
  @Input() invalidFields: string[] = [];

  @Output() readonly entriesChange = new EventEmitter<RuleActionPayloadEntry[]>();

  protected readonly valueTypeOptions = VALUE_TYPE_OPTIONS;

  protected readonly OTHER_SENTINEL = "__other__";

  protected resolvedKeyOptions(): string[] {
    return Array.from(this.keyOptions);
  }

  protected isCustomKey(entry: RuleActionPayloadEntry): boolean {
    return !this.keyOptions.includes(entry.key);
  }

  protected selectValue(entry: RuleActionPayloadEntry): string {
    return this.isCustomKey(entry) ? this.OTHER_SENTINEL : entry.key;
  }

  protected onSelectChange(index: number, selected: string): void {
    if (selected === this.OTHER_SENTINEL) {
      this.updateEntry(index, { key: "" });
    } else {
      this.updateEntry(index, { key: selected });
    }
  }

  protected addEntry(): void {
    this.entriesChange.emit([
      ...this.entries,
      {
        key: this.keyOptions[0] ?? "",
        value: "",
        value_type: normalizeValueType("STRING"),
      },
    ]);
  }

  protected removeEntry(index: number): void {
    const next = this.entries.filter((_, rowIndex) => rowIndex !== index);
    this.entriesChange.emit(next);
  }

  protected updateEntry(index: number, patch: Partial<RuleActionPayloadEntry>): void {
    this.entriesChange.emit(
      this.entries.map((entry, rowIndex) => {
        if (rowIndex !== index) {
          return entry;
        }
        return {
          ...entry,
          ...patch,
        };
      })
    );
  }

  protected trackEntry(index: number): number {
    return index;
  }

  protected isInvalidEntry(entry: RuleActionPayloadEntry): boolean {
    return this.invalidFields.includes(entry.key);
  }
}
