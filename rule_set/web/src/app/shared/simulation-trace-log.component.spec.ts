import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';

import { SimulationTraceLogComponent } from './simulation-trace-log.component';
import { OfferEvaluationResult } from '../models/api.models';

function makeEvaluations(codes: string[]): OfferEvaluationResult[] {
  return codes.map((code) => ({
    offerCode: code,
    dictamen: { preEligible: true },
  }));
}

describe('SimulationTraceLogComponent', () => {
  let component: SimulationTraceLogComponent;
  let fixture: ComponentFixture<SimulationTraceLogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SimulationTraceLogComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SimulationTraceLogComponent);
    component = fixture.componentInstance;
    component.title = 'Test log';
    component.evaluations = makeEvaluations(['A', 'B', 'C']);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('default collapsed — no offer is expanded after initial render', () => {
    expect(component['expanded']().size).toBe(0);
    expect(component['isExpanded']('A')).toBeFalse();
    expect(component['isExpanded']('B')).toBeFalse();
    expect(component['isExpanded']('C')).toBeFalse();
  });

  it('toggle(code) expands only that offer; others stay collapsed', () => {
    component['toggle']('A');
    expect(component['isExpanded']('A')).toBeTrue();
    expect(component['isExpanded']('B')).toBeFalse();
    expect(component['isExpanded']('C')).toBeFalse();
  });

  it('toggle(code) twice returns to collapsed state', () => {
    component['toggle']('A');
    component['toggle']('A');
    expect(component['isExpanded']('A')).toBeFalse();
  });

  it('toggleAll(true) expands all offers', () => {
    component['toggleAll'](true);
    expect(component['isExpanded']('A')).toBeTrue();
    expect(component['isExpanded']('B')).toBeTrue();
    expect(component['isExpanded']('C')).toBeTrue();
  });

  it('toggleAll(false) collapses all offers', () => {
    component['toggleAll'](true);
    component['toggleAll'](false);
    expect(component['expanded']().size).toBe(0);
  });

  it('allExpanded computed returns true only when every evaluation code is in the set', () => {
    expect(component['allExpanded']()).toBeFalse();
    component['toggle']('A');
    component['toggle']('B');
    expect(component['allExpanded']()).toBeFalse();
    component['toggle']('C');
    expect(component['allExpanded']()).toBeTrue();
  });

  it('ngOnChanges resets expanded set when evaluations input changes', () => {
    component['toggleAll'](true);
    expect(component['expanded']().size).toBe(3);

    component.evaluations = makeEvaluations(['X', 'Y']);
    component.ngOnChanges({
      evaluations: new SimpleChange(
        makeEvaluations(['A', 'B', 'C']),
        makeEvaluations(['X', 'Y']),
        false
      ),
    });

    expect(component['expanded']().size).toBe(0);
  });
});
