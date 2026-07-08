# SDD Explore — params-active-period

**Change**: mejora UX de períodos en el configurador (params + reglas)
**Fecha**: 2026-06-05
**Engram**: `sdd/params-active-period/explore` (obs #122)

## Petición del usuario

1. Los parámetros deben crearse en el período de vigencia activo (como las reglas) — eliminar el selector de período del formulario de params.
2. Norma nueva: para crear/editar reglas o parámetros debe haber un período activo aplicable; si no, el botón de crear se desactiva.
3. Al crear un parámetro debe conservarse visible el listado actual (hoy desaparece).
4. Compactar el formulario: el campo valor ocupa el hueco del período eliminado.

## Estado actual

### ActivePeriodService (`rule_set/web/src/app/services/active-period.service.ts`)

Servicio root con dos signals independientes persistidos en localStorage:
- `activePeriodRules` → key `activePeriod.rules`
- `activePeriodParams` → key `activePeriod.params`

El período activo es una **selección explícita del usuario** en la página offer-dates. Sin auto-detección por fecha. Si localStorage está vacío → signals null, sin fallback.

`AdminFechaItem`: `offer_date_id`, `tipo_cd` (REGLAS | PARAMS | AMBOS), `valid_from`, `valid_to`. `cfg_offer_dates` es **global** — sin scope por oferta.

### Flujo de REGLAS (período)

- `ruleForm` declara `offer_date_id: [null]` — configurator-page.component.ts:152
- `openCreateRuleEditor()` resetea a null — :730. **NO auto-rellena desde ActivePeriodService.**
- HTML :334–342: `<select>` con `fechasForRules()` + opción "— Sin período —".
- `buildRulePayloadFromForm()` envía `offer_date_id` o null — :1536.
- Backend `admin_validator.js:59–61`: **exige entero positivo — null se rechaza** → bug silente hoy: crear regla sin elegir período falla con 400.

### Flujo de PARAMS (período)

- `paramForm` declara `offer_date_id: [null]` — :160; `openCreateParamEditor()` resetea a null — :954.
- HTML :598–605: `<select>` con `fechasForParams()` + opción null.
- `saveParam()` envía `offer_date_id` o null — :914.
- Backend `admin_validator.js:197–200`: obligatorio en create (`allowPartial=false`), opcional en update.
- Schema: `cfg_offer_param.offer_date_id INT NOT NULL` (data_model.sql:79).

### Por qué desaparece el listado de params

Panel params (HTML :567–709) usa guards `*ngIf="!isParamEditorOpen()"` en: label de búsqueda (:567), mensajes de estado (:622–627), wrapper de tabla (:631), pager (:697). Al abrir el editor, todos esos bloques se destruyen del DOM.

**El panel de reglas usa el mismo patrón** (HTML :299, :399–408, :544) — la lista de reglas también desaparece al editar.

### Layout actual del formulario de params

HTML :580–616, CSS :226–236. `.form-grid-params` = grid de 6 columnas, cada label `span 3` → 2 por fila:

```
Fila 1: [Oferta] | [Key]
Fila 2: [Value type] | [Período]
Full-width: [Value]  ← fuera del grid
```

Quitando Período y metiendo Value al grid:

```
Fila 1: [Oferta] | [Key]
Fila 2: [Value type] | [Value]
```

Funciona directo: 4 labels × span 3 = 2 filas × 2 cols, sin cambio de layout.

## Enfoques

| Enfoque | Descripción | Pros | Contras | Esfuerzo |
|---------|-------------|------|---------|----------|
| **A (recomendado)** | Quitar selector de ambos formularios; auto-inyectar `activePeriodService.activePeriodX().offer_date_id` en create; desactivar "Crear" si período null; mover value al grid; quitar guards `!isEditorOpen()` de las tablas | Elimina riesgo de período erróneo; sin cambios backend; cubre los 4 requisitos | Edit no permite cambiar período (delete+recreate) | Bajo-Medio |
| B | Mantener selector con default al período activo | Flexible | El usuario aún puede equivocarse; no resuelve el UX | Bajo |

## Riesgos

1. **Bug existente**: ambos validators exigen `offer_date_id > 0` en create pero el FE manda null por defecto → toda alta sin selección manual falla hoy. El enfoque A lo corrige de paso.
2. **Edit sin cambio de período**: reasignar período requerirá borrar + recrear. Confirmar con usuario.
3. **Panel de reglas**: tiene el mismo patrón de lista-desaparece. Decidir si se arregla solo params o ambos.
4. **localStorage**: sin período seleccionado (incognito/otro navegador) los botones de crear quedan desactivados hasta pasar por offer-dates. Correcto, pero el banner debe explicarlo.
5. **Sin scope por oferta**: confirmado, `cfg_offer_dates` es global. Sin problema arquitectónico.

## Listo para proposal: Sí
