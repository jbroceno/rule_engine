import { ComponentFixture, TestBed } from "@angular/core/testing";
import { CommonModule } from "@angular/common";
import { ReactiveFormsModule } from "@angular/forms";
import { signal } from "@angular/core";

import {
  SimulatorFormComponent,
  SimulatorFormSubmit,
  InitFormValues,
  PreFormValues,
  FinalFormValues,
} from "./simulator-form.component";
import { WfValidationService } from "../../services/wf-validation.service";

// ---------------------------------------------------------------------------
// Mock service
// ---------------------------------------------------------------------------
const mockWfValidationService: Partial<WfValidationService> = {
  validateWf: signal(false),
  wfToken: signal(""),
  wfTokenExpCd: signal(""),
  comunidadAutonoma: signal(""),
  numPersonaT1: signal(""),
  numPersonaT2: signal(""),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createComponent(
  phase: "INIT" | "PRE" | "FINAL",
): ComponentFixture<SimulatorFormComponent> {
  const fixture = TestBed.createComponent(SimulatorFormComponent);
  fixture.componentInstance.phase = phase;
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("SimulatorFormComponent", () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SimulatorFormComponent, CommonModule, ReactiveFormsModule],
      providers: [
        { provide: WfValidationService, useValue: mockWfValidationService },
      ],
    }).compileComponents();
  });

  // -------------------------------------------------------------------------
  // Component creation smoke
  // -------------------------------------------------------------------------
  it("should create", () => {
    const fixture = createComponent("INIT");
    expect(fixture.componentInstance).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // Phase INIT — control enable/disable
  // -------------------------------------------------------------------------
  describe("phase = INIT", () => {
    let component: SimulatorFormComponent;
    let fixture: ComponentFixture<SimulatorFormComponent>;

    beforeEach(() => {
      fixture = createComponent("INIT");
      component = fixture.componentInstance;
    });

    it("disables INIT-irrelevant controls after ngOnInit", () => {
      const c = component["form"].controls;
      expect(c.numTitulares.disabled).toBeTrue();
      expect(c.ingresosT1.disabled).toBeTrue();
      expect(c.pagasT1.disabled).toBeTrue();
      expect(c.edadT2.disabled).toBeTrue();
      expect(c.antiguedadT2.disabled).toBeTrue();
      expect(c.domiciliaNominaT2.disabled).toBeTrue();
      expect(c.ingresosT2.disabled).toBeTrue();
      expect(c.pagasT2.disabled).toBeTrue();
      expect(c.chained.disabled).toBeTrue();
      expect(c.importeHipoteca.disabled).toBeTrue();
      expect(c.plazo.disabled).toBeTrue();
    });

    it("keeps INIT-relevant controls enabled", () => {
      const c = component["form"].controls;
      expect(c.edadT1.enabled).toBeTrue();
      expect(c.antiguedadT1.enabled).toBeTrue();
      expect(c.domiciliaNominaT1.enabled).toBeTrue();
      expect(c.finalidad.enabled).toBeTrue();
      expect(c.primeraViviendaHabitual.enabled).toBeTrue();
      expect(c.tipoAlta.enabled).toBeTrue();
      expect(c.importeVivienda.enabled).toBeTrue();
      expect(c.importeVentaCA.enabled).toBeTrue();
    });

    it("emits INIT payload with correct shape on valid submit", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      expect(emitted.length).toBe(1);
      const payload = emitted[0];
      expect(payload.phase).toBe("INIT");
      if (payload.phase === "INIT") {
        const v: InitFormValues = payload.values;
        expect(typeof v.edadT1).toBe("number");
        expect(typeof v.antiguedadT1).toBe("number");
        expect(typeof v.domiciliaNominaT1).toBe("boolean");
        expect(typeof v.finalidad).toBe("number");
        expect(typeof v.primeraViviendaHabitual).toBe("boolean");
        expect(typeof v.tipoAlta).toBe("string");
        expect(typeof v.importeVivienda).toBe("number");
        expect(typeof v.importeVentaCA).toBe("number");
      }
    });

    it("does NOT include income or two-titular fields in INIT payload", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      expect(emitted.length).toBe(1);
      const payload = emitted[0];
      expect(payload.phase).toBe("INIT");
      if (payload.phase === "INIT") {
        const v = payload.values as unknown as Record<string, unknown>;
        expect(v["numTitulares"]).toBeUndefined();
        expect(v["ingresosT1"]).toBeUndefined();
        expect(v["pagasT1"]).toBeUndefined();
        expect(v["importeHipoteca"]).toBeUndefined();
        expect(v["plazo"]).toBeUndefined();
      }
    });

    it("does NOT emit when form is invalid", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["form"].controls.edadT1.setValue(15); // below min(18)
      component["submit"]();

      expect(emitted.length).toBe(0);
      expect(component["form"].touched).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // Phase PRE — control enable/disable
  // -------------------------------------------------------------------------
  describe("phase = PRE", () => {
    let component: SimulatorFormComponent;
    let fixture: ComponentFixture<SimulatorFormComponent>;

    beforeEach(() => {
      fixture = createComponent("PRE");
      component = fixture.componentInstance;
    });

    it("disables PRE-irrelevant controls (importeHipoteca, plazo)", () => {
      const c = component["form"].controls;
      expect(c.importeHipoteca.disabled).toBeTrue();
      expect(c.plazo.disabled).toBeTrue();
    });

    it("keeps PRE-relevant controls enabled", () => {
      const c = component["form"].controls;
      expect(c.numTitulares.enabled).toBeTrue();
      expect(c.edadT1.enabled).toBeTrue();
      expect(c.antiguedadT1.enabled).toBeTrue();
      expect(c.domiciliaNominaT1.enabled).toBeTrue();
      expect(c.ingresosT1.enabled).toBeTrue();
      expect(c.pagasT1.enabled).toBeTrue();
      expect(c.finalidad.enabled).toBeTrue();
      expect(c.importeVivienda.enabled).toBeTrue();
      expect(c.importeVentaCA.enabled).toBeTrue();
      expect(c.chained.enabled).toBeTrue();
    });

    it("emits PRE payload with correct shape on valid submit", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      expect(emitted.length).toBe(1);
      const payload = emitted[0];
      expect(payload.phase).toBe("PRE");
      if (payload.phase === "PRE") {
        const v: PreFormValues = payload.values;
        expect(typeof v.numTitulares).toBe("number");
        expect(typeof v.edadT1).toBe("number");
        expect(typeof v.ingresosT1).toBe("number");
        expect(typeof v.pagasT1).toBe("number");
        expect(typeof v.chained).toBe("boolean");
        expect(typeof v.finalidad).toBe("number");
        expect(typeof v.importeVivienda).toBe("number");
      }
    });

    it("does NOT include importeHipoteca or plazo in PRE payload", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      const payload = emitted[0];
      if (payload.phase === "PRE") {
        const v = payload.values as unknown as Record<string, unknown>;
        expect(v["importeHipoteca"]).toBeUndefined();
        expect(v["plazo"]).toBeUndefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Phase FINAL — control enable/disable
  // -------------------------------------------------------------------------
  describe("phase = FINAL", () => {
    let component: SimulatorFormComponent;
    let fixture: ComponentFixture<SimulatorFormComponent>;

    beforeEach(() => {
      fixture = createComponent("FINAL");
      component = fixture.componentInstance;
    });

    it("all controls are enabled in FINAL phase (none disabled by phase)", () => {
      const c = component["form"].controls;
      expect(c.importeHipoteca.enabled).toBeTrue();
      expect(c.plazo.enabled).toBeTrue();
      expect(c.ingresosT1.enabled).toBeTrue();
      expect(c.pagasT1.enabled).toBeTrue();
      expect(c.numTitulares.enabled).toBeTrue();
      expect(c.chained.enabled).toBeTrue();
    });

    it("emits FINAL payload with both preValues and finalValues", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      expect(emitted.length).toBe(1);
      const payload = emitted[0];
      expect(payload.phase).toBe("FINAL");
      if (payload.phase === "FINAL") {
        const pre: PreFormValues = payload.preValues;
        const fin: FinalFormValues = payload.finalValues;
        expect(typeof pre.numTitulares).toBe("number");
        expect(typeof pre.ingresosT1).toBe("number");
        expect(typeof fin.importeHipoteca).toBe("number");
        expect(typeof fin.plazo).toBe("number");
      }
    });

    it("preValues does NOT contain importeHipoteca or plazo", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      const payload = emitted[0];
      if (payload.phase === "FINAL") {
        const pre = payload.preValues as unknown as Record<string, unknown>;
        expect(pre["importeHipoteca"]).toBeUndefined();
        expect(pre["plazo"]).toBeUndefined();
      }
    });

    it("finalValues does NOT contain pre-specific fields", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      const payload = emitted[0];
      if (payload.phase === "FINAL") {
        const fin = payload.finalValues as unknown as Record<string, unknown>;
        expect(fin["edadT1"]).toBeUndefined();
        expect(fin["ingresosT1"]).toBeUndefined();
        expect(fin["numTitulares"]).toBeUndefined();
      }
    });

    it("FINAL emit: preValues has exactly the PreFormValues keys", () => {
      const emitted: SimulatorFormSubmit[] = [];
      component.formSubmit.subscribe((v) => emitted.push(v));

      component["submit"]();

      const payload = emitted[0];
      if (payload.phase === "FINAL") {
        const preKeys = Object.keys(payload.preValues).sort();
        const expected: (keyof PreFormValues)[] = [
          "numTitulares", "edadT1", "antiguedadT1", "domiciliaNominaT1",
          "ingresosT1", "pagasT1", "edadT2", "antiguedadT2",
          "domiciliaNominaT2", "ingresosT2", "pagasT2", "finalidad",
          "primeraViviendaHabitual", "tipoAlta", "importeVivienda",
          "importeVentaCA", "chained",
        ];
        expect(preKeys).toEqual(expected.slice().sort());
      }
    });

    it("isTwoTitulares is false by default (numTitulares = 1)", () => {
      expect(component["isTwoTitulares"]()).toBeFalse();
    });

    it("isTwoTitulares becomes true when numTitulares changes to 2", () => {
      component["form"].controls.numTitulares.setValue(2);
      fixture.detectChanges();
      expect(component["isTwoTitulares"]()).toBeTrue();
    });
  });

  // -------------------------------------------------------------------------
  // Triangulation: isTwoTitulares across phases
  // -------------------------------------------------------------------------
  describe("isTwoTitulares computed signal", () => {
    it("reflects numTitulares=1 as false in PRE phase", () => {
      const fixture = createComponent("PRE");
      const component = fixture.componentInstance;
      component["form"].controls.numTitulares.setValue(1);
      fixture.detectChanges();
      expect(component["isTwoTitulares"]()).toBeFalse();
    });

    it("reflects numTitulares=2 as true in PRE phase", () => {
      const fixture = createComponent("PRE");
      const component = fixture.componentInstance;
      component["form"].controls.numTitulares.setValue(2);
      fixture.detectChanges();
      expect(component["isTwoTitulares"]()).toBeTrue();
    });
  });
});
