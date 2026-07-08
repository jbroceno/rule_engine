import { CommonModule } from "@angular/common";
import { Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

import { AdminRuleCondition } from "../../models/admin.models";
import { VALUE_TYPE_OPTIONS, normalizeValueType } from "../../shared/rule-catalogs";
import { RULE_OPERATOR_OPTIONS, normalizeRuleOperator } from "../../shared/rule-operators";

type GroupedCondition = {
  index: number;
  condition: AdminRuleCondition;
};

type ConditionGroup = {
  groupId: number;
  rows: GroupedCondition[];
};

@Component({
  selector: "app-rule-conditions-table",
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: "./rule-conditions-table.component.html",
  styleUrl: "./rule-conditions-table.component.css",
})
export class RuleConditionsTableComponent {
  @Input({ required: true }) conditions: AdminRuleCondition[] = [];
  @Input() invalidConditionFields: string[] = [];

  @Output() readonly conditionsChange = new EventEmitter<AdminRuleCondition[]>();

  protected readonly operatorOptions = RULE_OPERATOR_OPTIONS;
  protected readonly valueTypeOptions = VALUE_TYPE_OPTIONS;

  protected normalizeOperatorForSelect(operator: unknown): string {
    return normalizeRuleOperator(operator) || "EQ";
  }

  protected groupedConditions(): ConditionGroup[] {
    const groups = new Map<number, GroupedCondition[]>();
    this.conditions.forEach((condition, index) => {
      const rows = groups.get(condition.group_id) ?? [];
      rows.push({ index, condition });
      groups.set(condition.group_id, rows);
    });

    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([groupId, rows]) => ({ groupId, rows }));
  }

  protected addConditionToGroup(groupId: number): void {
    this.conditionsChange.emit([...this.conditions, this.buildDefaultCondition(groupId)]);
  }

  protected addOrGroup(): void {
    const maxGroupId = this.conditions.reduce((max, current) => Math.max(max, current.group_id), -1);
    this.conditionsChange.emit([...this.conditions, this.buildDefaultCondition(maxGroupId + 1)]);
  }

  protected removeCondition(index: number): void {
    const next = this.conditions.filter((_, rowIndex) => rowIndex !== index);
    this.conditionsChange.emit(next.length > 0 ? next : [this.buildDefaultCondition(0)]);
  }

  protected isUnaryOperator(operator: unknown): boolean {
    const op = normalizeRuleOperator(operator);
    return op === "IS_TRUE" || op === "IS_FALSE";
  }

  protected updateConditionText(index: number, field: "left_operand" | "operator", value: string): void {
    const trimmedValue = value.trim();
    const patch: Partial<AdminRuleCondition> = { [field]: trimmedValue };
    if (field === "operator" && this.isUnaryOperator(trimmedValue)) {
      patch.right_operand = null;
      patch.value2 = null;
    }
    this.patchCondition(index, patch);
  }

  protected updateConditionOperand(index: number, field: "right_operand" | "value2", value: string): void {
    this.patchCondition(index, {
      [field]: value,
    } as Pick<AdminRuleCondition, "right_operand" | "value2">);
  }

  protected updateConditionValueType(index: number, valueType: AdminRuleCondition["value_type"]): void {
    this.patchCondition(index, { value_type: normalizeValueType(valueType) });
  }

  protected displayOperand(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  protected trackGroup(_: number, group: ConditionGroup): number {
    return group.groupId;
  }

  protected trackCondition(_: number, row: GroupedCondition): number {
    return row.index;
  }

  protected isInvalidField(index: number, field: "left_operand" | "operator" | "right_operand" | "value_type" | "value2"): boolean {
    return this.invalidConditionFields.includes(`conditions[${index}].${field}`);
  }

  private patchCondition(index: number, patch: Partial<AdminRuleCondition>): void {
    this.conditionsChange.emit(
      this.conditions.map((condition, rowIndex) => {
        if (rowIndex !== index) {
          return condition;
        }
        return {
          ...condition,
          ...patch,
        };
      })
    );
  }

  private buildDefaultCondition(groupId: number): AdminRuleCondition {
      return {
        group_id: groupId,
        left_operand: "",
        operator: "EQ",
        right_operand: "",
        value_type: normalizeValueType("STRING"),
      };
  }
}
