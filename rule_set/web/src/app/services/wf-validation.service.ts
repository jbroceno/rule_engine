import { effect, Injectable, signal } from "@angular/core";

const LS_TOKEN       = "wf_token";
const LS_TOKEN_EXP   = "wf_token_exp_cd";
const LS_CCAA        = "wf_comunidad_autonoma";
const LS_PERSONA_T1  = "wf_num_persona_t1";
const LS_PERSONA_T2  = "wf_num_persona_t2";

@Injectable({ providedIn: "root" })
export class WfValidationService {
  readonly validateWf       = signal(false);
  readonly wfToken          = signal(localStorage.getItem(LS_TOKEN) ?? "");
  readonly wfTokenExpCd     = signal(localStorage.getItem(LS_TOKEN_EXP) ?? "");
  readonly comunidadAutonoma = signal(localStorage.getItem(LS_CCAA) ?? "");
  readonly numPersonaT1     = signal(localStorage.getItem(LS_PERSONA_T1) ?? "");
  readonly numPersonaT2     = signal(localStorage.getItem(LS_PERSONA_T2) ?? "");

  constructor() {
    effect(() => localStorage.setItem(LS_TOKEN,      this.wfToken()));
    effect(() => localStorage.setItem(LS_TOKEN_EXP,  this.wfTokenExpCd()));
    effect(() => localStorage.setItem(LS_CCAA,       this.comunidadAutonoma()));
    effect(() => localStorage.setItem(LS_PERSONA_T1, this.numPersonaT1()));
    effect(() => localStorage.setItem(LS_PERSONA_T2, this.numPersonaT2()));
  }
}
