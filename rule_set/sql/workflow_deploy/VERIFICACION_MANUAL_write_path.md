# Verificación manual del write-path (deploy a WF + restore a POC)

> Cubre lo que NO se puede verificar con SQL puro: la lógica JS de despliegue
> (`publishCfgToWorkflow`, `upsertMotorFecha`, `deletePeriodFromMRO`,
> `insertMRORecords`, `createWorkflowSnapshot`, `restoreSnapshot`) y el **caso 7**
> del checklist (restore WF→POC end-to-end).
>
> Los dos SPs (lectura y snapshot WF) ya están verificados con
> `verify_read_sp.sql` y `verify_snapshot_sp.sql`.

## Preparación

| Requisito | Detalle |
|-----------|---------|
| API levantada | `npm run api:start` desde `rule_set/` (con `api/.env` apuntando a POC y WF) |
| Front levantado | `npm run web:start` → http://localhost:4200 |
| Conexión WF | El pool WF (`getWfSqlPool`) debe resolver contra la base WF real |
| Oferta de prueba | Elegí una oferta conocida (ej. `FIDELIZACION`) y una **fecha de período de prueba** que no choque con datos reales, ej. `vigDesde = 2026-07-01` |

> Sugerencia: hacé estas pruebas en un período de vigencia nuevo (`2026-07-01`)
> para no pisar configuración real. Si querés revertir, restaurá el snapshot de
> seguridad que el propio deploy genera.

---

## Bloque A — Capacidad 2: publicar la configuración actual a WF

**UI:** Configurador → botón **"Publicar a WF"** → elegí `TIPO_DS = AMBOS`, rango destino `vigDesde = 2026-07-01`, `vigHasta = (vacío)` → confirmar.

**Respuesta esperada del endpoint** (`POST /api/admin/workflow/publicar`): JSON con `published: true`, `rules`, `params`, y **`prePublishSnapshotId`** (el snapshot de seguridad).

**Verificación SQL** (reemplazá `@fid` por el `MOTORFECHA_ID` que veas en el primer query):

```sql
-- A1. Se creó (o reusó) el período MOTORFECHA para (DESDE, HASTA, TIPO)
DECLARE @fid INT
SELECT @fid=MOTORFECHA_ID, DESDE_DT, HASTA_DT, TIPO_DS
FROM dbo.MRO_MOTORFECHA
WHERE DESDE_DT = '20260701' AND TIPO_DS = 'AMBOS'
ORDER BY MOTORFECHA_ID DESC;

-- A2. Reglas y params apuntan a ese MOTORFECHA_ID
SELECT TOP 20 MOTORREGLA_ID, MOTOROFERTA_ID, MOTORFECHA_ID, MOTORREGLA_DS
FROM dbo.MRO_MOTORREGLA WHERE MOTORFECHA_ID = @fid;

SELECT TOP 20 MOTORPARAM_ID, MOTOROFERTA_ID, MOTORFECHA_ID, PARAM_KEY_CD
FROM dbo.MRO_MOTORPARAM WHERE MOTORFECHA_ID = @fid;

-- A3. NO se escriben columnas VIGENCIA_* (no existen en el modelo nuevo).
--     Este query DEBE FALLAR con "Invalid column name 'VIGENCIA_DESDE_DT'":
SELECT TOP 1 VIGENCIA_DESDE_DT FROM dbo.MRO_MOTORREGLA;

-- A4. Snapshot de seguridad pre-publish creado en POC
SELECT TOP 5 snapshot_id, snapshot_name, entorno_cd, comment, created_at
FROM dbo.cfg_config_snapshot
ORDER BY snapshot_id DESC;
```

| # | Esperado | OK? |
|---|----------|-----|
| A1 | Existe 1 fila MOTORFECHA con `DESDE_DT=2026-07-01`, `TIPO_DS=AMBOS` | ☐ |
| A2 | Reglas y params con `MOTORFECHA_ID` = ese id (no NULL) | ☐ |
| A3 | El query **falla** (columna inexistente) → confirma que no hay escritura inline | ☐ |
| A4 | Aparece un snapshot reciente cuyo `snapshot_id` = `prePublishSnapshotId` de la respuesta | ☐ |

---

## Bloque B — Reuso de período exacto + ids sin reuso (republish)

Volvé a publicar **el mismo** `(vigDesde=2026-07-01, vigHasta vacío, TIPO_DS=AMBOS)`.

```sql
-- B0. ANTES de republicar: anotá los máximos
SELECT MAX(MOTORFECHA_ID) AS maxF, MAX(MOTORREGLA_ID) AS maxR, MAX(MOTORPARAM_ID) AS maxP
FROM dbo.MRO_MOTORREGLA;  -- (corré los MAX por tabla; ver nota)
```
> Nota: corré `SELECT MAX(MOTORFECHA_ID) FROM dbo.MRO_MOTORFECHA`,
> `SELECT MAX(MOTORREGLA_ID) FROM dbo.MRO_MOTORREGLA`,
> `SELECT MAX(MOTORPARAM_ID) FROM dbo.MRO_MOTORPARAM` por separado.

Republicá desde la UI. Luego:

```sql
-- B1. El MOTORFECHA_ID NO cambió (se reusó el período exacto, no se creó otro)
SELECT MOTORFECHA_ID FROM dbo.MRO_MOTORFECHA
WHERE DESDE_DT='20260701' AND TIPO_DS='AMBOS';   -- debe seguir siendo 1 fila, mismo id

-- B2. Las reglas NO se duplicaron: el conteo para ese MOTORFECHA_ID
--     coincide con la cantidad de reglas de origen (no el doble)
SELECT COUNT(*) FROM dbo.MRO_MOTORREGLA WHERE MOTORFECHA_ID = @fid;

-- B3. Los nuevos ids continúan por ENCIMA del máximo previo (sin reuso de slots)
SELECT MIN(MOTORREGLA_ID) AS minNuevo FROM dbo.MRO_MOTORREGLA WHERE MOTORFECHA_ID=@fid;
-- minNuevo debe ser > maxR anotado en B0
```

| # | Esperado | OK? |
|---|----------|-----|
| B1 | Mismo `MOTORFECHA_ID` que en el bloque A (período reusado) | ☐ |
| B2 | Conteo de reglas = el de origen (las viejas se borraron y reinsertaron, sin duplicar) | ☐ |
| B3 | Los `MOTORREGLA_ID` nuevos son mayores al `maxR` previo (high-water mark, sin reuso) | ☐ |

---

## Bloque C — Capacidad 3: publicar un snapshot de POC a WF

**UI:** Snapshots → sobre una fila de **origen POC**, botón **"Publicar en WF"** → rango destino `2026-08-01`.

```sql
SELECT MOTORFECHA_ID, DESDE_DT, TIPO_DS FROM dbo.MRO_MOTORFECHA WHERE DESDE_DT='20260801';
SELECT COUNT(*) FROM dbo.MRO_MOTORREGLA r
  INNER JOIN dbo.MRO_MOTORFECHA mf ON mf.MOTORFECHA_ID=r.MOTORFECHA_ID
  WHERE mf.DESDE_DT='20260801';
```

| # | Esperado | OK? |
|---|----------|-----|
| C1 | Se creó el período `2026-08-01` con reglas/params del snapshot POC | ☐ |
| C2 | Los `offerCode` del snapshot resolvieron a `oferta_id` correctos (sin error 400 de "ningún offerCode coincide") | ☐ |

---

## Bloque D — Capacidad 1 + Caso 7: snapshot WF y restore a POC (end-to-end)

1. **Generar snapshot WF.** Snapshots → **"Generar Snapshot WF"** → rango de fechas `vigDesde=2026-07-01` (el publicado en bloque A).
   ```sql
   SELECT TOP 3 snapshot_id, snapshot_name, entorno_cd, created_at
   FROM dbo.cfg_config_snapshot WHERE entorno_cd='WF' ORDER BY snapshot_id DESC;
   ```
   Esperado: fila nueva `entorno_cd='WF'` con `rules_json` poblado.

2. **Restaurar ese snapshot WF a POC** (Caso 7). Snapshots → sobre la fila WF → **Restaurar** → `destino = POC`, `pocFechaDesde = 2026-09-01`.
   ```sql
   -- D2a. Período POC creado/usado
   SELECT * FROM dbo.cfg_offer_dates WHERE valid_from = '20260901';
   -- D2b. Reglas y params POC para ese período
   SELECT COUNT(*) FROM dbo.cfg_offer_rule  WHERE offer_date_id = <id de D2a>;
   SELECT COUNT(*) FROM dbo.cfg_offer_param WHERE offer_date_id = <id de D2a>;
   -- D2c. Snapshot de seguridad pre-restore
   SELECT TOP 3 snapshot_id, comment FROM dbo.cfg_config_snapshot ORDER BY snapshot_id DESC;
   ```

| # | Esperado | OK? |
|---|----------|-----|
| D1 | Snapshot WF generado con contenido (`rules_json` no vacío) | ☐ |
| D2a | Período POC `2026-09-01` existe | ☐ |
| D2b | Reglas/params POC poblados desde el snapshot WF (resolución `oferta_id`↔código, params dedup last-wins) | ☐ |
| D2c | Snapshot de seguridad "Auto: antes de restaurar…" creado | ☐ |

---

## Bloque E — Validación de contrato (rechazos)

| Acción | Esperado | OK? |
|--------|----------|-----|
| Restaurar con `destino` inválido (ej. `PRE`) vía API | HTTP 400 "entorno_cd debe ser POC o WF" (escenario 13, `validateEntornoCd`) | ☐ |
| Publicar con `tipoDs` inválido | HTTP 400 "tipoDs inválido" (`getDeleteScope`) | ☐ |

---

## Limpieza

Las pruebas de los bloques A-D escriben datos reales (períodos `2026-07/08/09`).
Para revertir: restaurá el snapshot de seguridad que cada deploy generó (bloque A4 / D2c),
o borrá manualmente los períodos de prueba y sus reglas/params.

> A diferencia de los harness SQL (que hacen ROLLBACK), esta verificación pasa por
> la app y **sí persiste** — usá fechas de prueba dedicadas y limpiá al terminar.
