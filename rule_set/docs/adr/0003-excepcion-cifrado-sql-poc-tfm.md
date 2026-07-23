# ADR 0003 — Excepción de cifrado en la conexión SQL para el entorno POC del TFM

**Estado**: Aceptado
**Fecha**: 2026-07-10
**Contexto de origen**: hallazgo OWASP-03 del [informe de auditoría OWASP Top 10 2026-07-10](../seguridad/informe-owasp-top10-2026-07-10.md).

## Contexto

La auditoría OWASP Top 10 detectó que la conexión de la API al SQL Server (Azure SQL Edge en Docker) se establece con `encrypt: false` y `trustServerCertificate: true` por defecto (`api/config/env.js:32-33`, forzado explícitamente en `docker-compose.yml:83-84,117-118`). Esto implica que el tráfico API↔SQL viaja sin cifrar y sin validación de certificado.

En un entorno de producción multi-tenant o expuesto a redes no confiables, esto sería una vulnerabilidad de Cryptographic Failures (OWASP A02) de severidad alta: un atacante con acceso a la red donde corre el tráfico podría interceptar credenciales y datos en texto plano.

## Decisión

Se acepta **no implementar cifrado TLS en la conexión SQL** para el alcance de este TFM (Trabajo Fin de Máster), por las siguientes razones:

1. El proyecto es una prueba de concepto (POC) académica, no un sistema en producción con datos reales de clientes ni tráfico expuesto a Internet.
2. SQL Server (Azure SQL Edge) está publicado únicamente en `127.0.0.1` (`docker-compose.yml:30`), por lo que no es alcanzable desde fuera del host Docker; el vector de ataque queda acotado a un compromiso previo del propio host o de otro contenedor de la misma red Docker interna — un escenario fuera del alcance de amenazas considerado para el TFM.
3. Configurar cifrado TLS extremo a extremo para SQL Server (certificados, CA, rotación) añadiría complejidad operativa desproporcionada al objetivo académico del proyecto (demostrar el motor de reglas y su arquitectura), sin aportar valor de aprendizaje adicional relevante para la evaluación.
4. El resto de hallazgos de la auditoría (control de acceso, salvaguardas de configuración, autenticación, logging) sí se consideran relevantes para la calidad y corrección del sistema evaluado y se abordan mediante el flujo SDD del proyecto.

## Consecuencias

- El hallazgo OWASP-03 se marca como **excepcionado** en el informe de auditoría, no como pendiente de corrección.
- Si este proyecto evolucionara hacia un entorno con datos reales o desplegado fuera de una red controlada, esta excepción debe revisarse: activar `encrypt: true` y `trustServerCertificate: false` (o `true` solo con CA propia validada), lo que ya está soportado por el driver `mssql`/`tedious` vía las variables de entorno `SQL_ENCRYPT` y `SQL_TRUST_SERVER_CERT` sin cambios de código.
- No se crea ninguna tarea SDD para este hallazgo.
