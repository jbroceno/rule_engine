# Motor de Reglas de Ofertas Hipotecarias

> **Trabajo Fin de Máster** — Máster en Desarrollo de Software potenciado con IA (BIG School)

Motor de reglas de negocio, configurable y determinista, que decide **qué oferta hipotecaria asignar a un expediente** evaluando los datos del solicitante contra conjuntos de reglas versionados. Incluye una **API REST**, un **frontend de administración y simulación** (Angular) y la integración con el **sistema de workflow** del banco para contrastar resultados.

El valor del proyecto no está en la complejidad algorítmica del motor —que es modesta y deliberadamente simple—, sino en **madurar una idea de negocio real hasta convertirla en una solución completa** y, sobre todo, en **cómo se ha usado la IA como herramienta de ingeniería** para llegar hasta ahí: análisis  funcional, diseño del motor, generación de las reglas a partir de la documentación y construcción del frontend de configuración a partir de esa misma documentación y del modelo de datos. Esto último —el configurador— es la pieza realmente compleja del sistema.

---

## 📑 Enlaces de entrega

| Recurso | Enlace |
|---------|--------|
| 📦 Repositorio (GitHub) | `git@github.com:jbroceno/rule_engine.git` <!-- TODO: confirmar que el repo es público o conceder acceso a mouredev@gmail.com --> |
| 🚀 Despliegue / demo | <!-- TODO: añadir URL de despliegue (si lo hay) --> _pendiente_ |
| 🖼️ Slides de presentación | <!-- TODO: añadir URL pública de la presentación --> _pendiente_ |
| 🎥 Vídeo explicativo | <!-- TODO: añadir URL pública del vídeo --> _pendiente_ |

> **Fecha de entrega del TFM:** 20/07/2026.

---

## ⚠️ Disclaimer

- Se trata de un problema de negocio real de una entidad bancaria. El repo es un clon del original anonimizando la documentación publicable y eliminando aquellas partes que no son relevantes para este proyecto o bien por su caracter confidencial.

- **La funcionalidad para validar el comportamiento del motor de ofertas en el sistema de *workflow* del banco no es accesible**. Se ha utilizado para crear pruebas automatizadas mediante un servicio web que contrastan los valores esperados y obtenidos por su motor/reglas/parámetros toda vez que el motor desarrollado en este proyecto se ha certificado.

---

## 1. Descripción general del proyecto

Una entidad bancaria quiere ofrecer **precios diferenciados** a los clientes que cumplen determinados requisitos. Antes de pre-aprobar una hipoteca y cada vez que se cambian los datos del préstamo es necesario calcular qué oferta le corresponde a cada perfil, ya que cada oferta impone límites distintos (LTV, plazo, importe, edad, ingresos mínimos, tipo de vivienda, etc.) y se identifica de forma diferenciada de cara al motor de riesgos.

Para resolverlo se construye un **motor de reglas** que, dada una configuración de reglas (un conjunto por oferta) y de parámetros, devuelve **las ofertas elegibles y los límites a aplicar** en cada momento. La evaluación se organiza en **tres fases** que reproducen el flujo real del simulador hipotecario:

| Fase | Qué decide | Con qué datos |
|------|------------|---------------|
| **INIT** | Elegibilidad inicial (edad, cliente, domiciliación, tipo de alta, finalidad, etc.) | Datos mínimos del expediente y el bien a hipotecar|
| **PRE** | Pre-elegibilidad + límites que restringen el simulador | Datos de la simulación inicial, información de edad e ingresos de los titulares|
| **FINAL** | Oferta ganadora sobre las pre-elegibles | Datos definitivos del préstamo (importe, plazo, LTV) |

El sistema permite **administrar reglas, parámetros y ofertas** desde una web, **simular** los tres estadios para validar el comportamiento, **historificar** la configuración por vigencias y **publicarla contra el sistema de workflow** del banco para contrastar el resultado del motor local con el del sistema real.

### El papel de la IA en este proyecto

Como TFM de un máster de **desarrollo potenciado con IA**, quisiera ser preciso sobre dónde he usado 
y dónde **no** la IA:

- **El motor NO usa ningún LLM en tiempo de ejecución.** Las decisiones de elegibilidad son **deterministas y reproducibles**: lógica DNF pura sobre una configuración JSON. No hay consultas a un modelo para decidir qué oferta gana.
- **La IA se ha usado como herramienta de ingeniería durante todo el ciclo de construcción:**
  - **Análisis funcional** de los requisitos a partir de la documentación de negocio (ver `prompts/prompts.md`, el rol de analista funcional usado).
  - **Diseño del motor** de reglas DNF, su contrato y su modelo de datos (ver `.opencode/prompts/dnf-engine.md` y `dnf-review.md`).
  - **Generación de las reglas y parámetros** (`rules.json`) traduciendo las condiciones de elegibilidad del documento funcional al formato del motor, incluida la aplicación sistemática del **patrón de inversión** (De Morgan) que se describe más abajo.
  - **Construcción del frontend de configuración** (la parte compleja) a partir de la documentación y del modelo de datos SQL.
  - **Generación de la batería de pruebas** y del modelo de evidencias dirigido por escenarios.

En resumen: **la IA ha construido y probado el sistema; el sistema funciona sin IA.**

### Metodología: desarrollo dirigido por especificación (SDD) con agentes de IA

Las funcionalidades **no** se han incorporado improvisando código contra el chat ("vibe-coding"), sino siguiendo **SDD (Spec-Driven Development)**: cada cambio relevante atraviesa un flujo estructurado y trazable antes de tocar el código, ejecutado mediante agentes de IA especializados.

```
explore → proposal → spec → design → tasks → apply → verify → archive
```

| Fase | Qué produce |
|------|-------------|
| **explore** | Investigación de la idea y del código existente; comparación de enfoques |
| **proposal** | Propuesta con intención, alcance, módulos afectados y plan de *rollback* |
| **spec** | Requisitos en formato *Given/When/Then* con palabras clave RFC 2119 (MUST/SHALL/SHOULD) |
| **design** | Decisiones de arquitectura (incluye diagramas de secuencia en cambios del pipeline) |
| **tasks** | Desglose en tareas pequeñas, agrupadas por fase (infraestructura/implementación/pruebas) |
| **apply** | Implementación siguiendo los patrones existentes, en **TDD estricto** |
| **verify** | Validación de la implementación contra la *spec* (clasifica CRITICAL/WARNING/SUGGESTION) |
| **archive** | Cierre del cambio y sincronización de las *specs* |

Todo el rastro queda **versionado en `openspec/`**. A día de hoy hay **10 cambios completados de extremo a extremo** (carpeta `openspec/changes/archive/`), entre ellos: despliegue al sistema de workflow, mapeo de ofertas WF, *snapshots* y restauración, vigencias por fecha/datetime, panel y correcciones del simulador, periodo activo de parámetros y la página de ofertas con cascada de periodos.

Esto refuerza la tesis del proyecto: la IA aporta velocidad, pero el **criterio de ingeniería** —qué especificar, qué validar y qué rechazar— permanece explícito, documentado y auditable en cada cambio.

> La configuración del flujo (stack, TDD estricto, reglas por fase) vive en `openspec/config.yaml`.

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|------------|
| **Motor de reglas** | Node.js (ESM), funciones puras, **sin dependencias externas** |
| **API REST** | Express 4 · `mssql` 11 · `dotenv` · `jsonwebtoken` · `bcryptjs` |
| **Base de datos** | SQL Server (tablas de configuración + procedimientos almacenados) |
| **Frontend** | Angular 20 · RxJS 7 · TypeScript 5.9 |
| **Pruebas** | Test runner nativo de Node (`node:test`) · Karma + Jasmine (frontend) |
| **Integración** | Adaptador de publicación al sistema de **Workflow** del banco |
| **Herramientas de IA** | Claude Code / OpenCode con prompts versionados (`prompts/`, `.opencode/prompts/`) |

> Requisitos de entorno: **Node.js 20+** y, para la API, una instancia de **SQL Server** accesible.

---

## 3. Instalación y ejecución

El código del proyecto vive en el subdirectorio `rule_set/`. Todos los comandos se ejecutan desde ahí.

### 3.1. Motor de reglas y API

```bash
cd rule_set
npm install

# Demo del motor por línea de comandos (carga rules.json e imprime resultados)
node offer_rule_engine.js
RULE_ENGINE_DEBUG=1 node offer_rule_engine.js   # con traza de depuración

# API REST
npm run api:start    # arranca el servidor Express
npm run api:dev      # modo watch (reinicio automático)
```

La API necesita la conexión a SQL Server. Copia el fichero de ejemplo y rellena tus credenciales:

```bash
cp api/.env.example api/.env
# edita api/.env con host, base de datos, usuario y contraseña de tu SQL Server
```

### 3.2. Frontend (Angular)

```bash
cd rule_set
npm run web:start    # sirve la UI en http://localhost:4200 (con proxy a la API)
npm run web:build    # build de producción en web/dist/
npm run web:test     # tests unitarios (Karma)
```

### 3.3. Pruebas

```bash
cd rule_set
npm test                                   # toda la suite (node:test)
npm run test:file -- test/rule_engine.test.js
npm run test:name -- "precheck"            # tests cuyo nombre contiene "precheck"
npm run test:scenarios                     # matriz de decisión ofertas × fases
```

### 3.4. Demo completo con Docker (recomendado para probar la app)

Levanta **SQL Server + API + frontend + datos** con un solo comando, sin instalar Node ni SQL Server en local. Desde la **raíz del repositorio**:

```bash
cp env.example .env          # Linux/macOS/Git Bash · (copy env.example .env en Windows CMD)
docker compose up --build
```

- **Frontend:** http://localhost:8080
- **API (health):** http://localhost:3000/api/health

El servicio `db-init` crea la base de datos, aplica el esquema y carga la semilla (`rule_set/sql/seed_offers.sql`) automáticamente. Credenciales y puertos se definen en `.env`.
Detalle completo en [`docker/README.md`](docker/README.md).

### 3.5. Atajos con `make`

El `Makefile` de la raíz envuelve los comandos de Docker anteriores. Ejecutar `make` (o `make help`) lista todos los targets disponibles:

```bash
make help          # lista de targets con descripción
make env           # crea .env a partir de env.example (si no existe)
make build          # construye las imágenes sin arrancar
make up             # build + arranque en foreground (logs en consola, Ctrl+C para parar)
make up-d           # build + arranque en segundo plano (detached)
make ps             # estado de los contenedores
make logs           # sigue los logs de todos los servicios
make restart        # down + up-d
make down           # detiene y elimina los contenedores (conserva los datos de SQL Server)
make add-user EMAIL=admin@example.com PASSWORD='s3cret'   # da de alta o actualiza un usuario admin
make reset-db       # borra el volumen de datos y vuelve a levantar el stack desde cero
make clean          # limpieza total: para el stack y elimina contenedores, volúmenes e imágenes construidas
```

> `make add-user` requiere el stack ya levantado (`make up`/`make up-d`): ejecuta
> `docker compose exec api node scripts/seed_user.mjs` con las credenciales indicadas dentro del
> contenedor `api`. Si el usuario ya existe, se actualiza su contraseña (`--force`).

> **Estado actual de la suite:** `251 tests · 226 pass · 0 fail · 25 skipped`.
> Los *skipped* son pruebas *live* del servicio de workflow que requieren credenciales reales de
> SQL Server; se omiten en local por diseño, no son fallos. El motor y los escenarios de negocio
> se ejecutan sin dependencias ni base de datos.

---

## 4. Estructura del proyecto

```
rule_engine/
├── README.md                  # este documento
├── doc/                       # documentación de negocio (análisis funcional, diagramas, plan de pruebas)
│   ├── 01 - spec.md           # especificación funcional completa (origen de las reglas)
│   ├── 03 - workflow_deployment.md
│   └── *.png                  # diagramas de alta/modificación de expediente
├── prompts/                   # prompts de IA para el análisis funcional
├── .opencode/prompts/         # prompts de IA para el diseño y revisión del motor DNF
├── openspec/                  # artefactos SDD versionados (proposal/spec/design/tasks/verify)
│   ├── config.yaml            # configuración del flujo SDD (stack, TDD estricto, reglas por fase)
│   └── changes/archive/       # 10 cambios completados de extremo a extremo
└── rule_set/                  # código del proyecto
    ├── rule_engine.js         # núcleo del motor (funciones puras, sin I/O)
    ├── rules.json             # configuración de ofertas + reglas + parámetros (fixture local)
    ├── offer_rule_engine.js   # demo por CLI
    ├── api/                   # API REST (Express)
    │   ├── routes/ controllers/ services/ validators/ utils/ db/
    │   └── .env.example
    ├── web/                   # frontend Angular 20 (simuladores + configurador + snapshots)
    │   └── src/app/{pages,services,models,shared}
    ├── fixtures/              # escenarios de negocio + runner + golden (fuente única de verdad)
    ├── scripts/               # generación de evidencias y freeze del golden
    ├── test/                  # suite de pruebas (node:test)
    └── sql/                   # esquema SQL Server + procedimientos + seeds + snapshots
```

---

## 5. Funcionalidades principales

### Motor de reglas (`rule_engine.js`)
- **Pipeline de 3 fases** independientes: `initcheck()` → `precheck()` → `finalize()`, más `normalizeConfig()` (validación) y `computeDerived()` (cálculo de LTV y base de garantía).
- **Evaluación DNF**: las condiciones que comparten `group_id` se combinan con **AND**; los grupos se combinan con **OR**. Reglas en orden de prioridad descendente.
- **Patrón de inversión**: las reglas actúan como *detectores de rechazo* (se disparan cuando el perfil **no** cumple). Las condiciones positivas del documento funcional se **niegan** aplicando las leyes de De Morgan antes de codificarlas. El nombre de cada regla documenta la condición positiva original (`neg.: …`) para trazar hasta la especificación.
- **Parámetros referenciables** (`PARAM:<KEY>`) resueltos en runtime, con ámbito por oferta.
- **Trazabilidad completa**: cada evaluación devuelve qué reglas y condiciones pasaron o fallaron.

### Frontend (Angular 20)
- **Simuladores** de las fases INIT, PRE y FINAL, con traza visual de la decisión.
- **Configurador**: CRUD de ofertas, reglas, condiciones, acciones y parámetros, con importación/exportación de configuración y aplicación con snapshot automático.
- **Vigencias**: gestión de periodos de configuración (`offer-dates`) y selección de periodo activo.
- **Snapshots**: navegador de copias de seguridad y restauración (con snapshot de seguridad previo).
- **Validación dual**: contrasta los datos de entrada contra el **motor local** y contra el **sistema de workflow** del banco para comparar resultados.

### API REST (`/api`)
- Simulación (`/simulate/init|pre|final`) y carga de configuración (`/config`).
- Administración (`/admin/*`): ofertas, reglas, parámetros, validación, export, *apply* con snapshot y gestión/restauración de snapshots.

### Calidad y evidencias
- **Modelo de escenarios dirigido por datos**: los tests y el informe de evidencias para cliente consumen las **mismas** definiciones de escenarios, de modo que **nunca pueden divergir**. El *golden* es generado por el motor y revisado a mano; el script de *freeze* falla si el ganador calculado por el motor no coincide con el ganador esperado del cuadro de decisión de negocio.

---

## 6. Autenticación (JWT)

La aplicación está protegida con **autenticación por token JWT** (JSON Web Token).

### Cómo funciona

El usuario introduce su email y contraseña en la página de login. Si las credenciales son válidas, la API devuelve un token JWT firmado (HS256, validez configurable, por defecto 8 horas). El frontend almacena ese token en `localStorage` y lo adjunta como cabecera `Authorization: Bearer <token>` en todas las peticiones posteriores. Si el token expira o es inválido, la API devuelve 401 y el frontend redirige automáticamente al login.

La API protege **todas las rutas `/api/*`** excepto `GET /api/health` y `POST /api/auth/login`.

Los contraseñas se almacenan hasheadas con **bcryptjs** (coste 10) en la tabla `dbo.cfg_user`.

### Alta del primer usuario

La tabla `dbo.cfg_user` se crea con `rule_set/sql/users.sql`. El primer usuario se da de alta con el script incluido:

```bash
cd rule_set
node scripts/seed_user.mjs --email admin@example.com --password 's3cret'
```
Si tienes levantado el contenedor de docker puedes hacerlo con

```bash
docker compose exec api node scripts/seed_user.mjs --email admin@example.com --password 's3cret'
```

### Orden de despliegue

> Hay que respetar este orden para evitar un **bloqueo total** del sistema (si el middleware JWT
> está activo sin ningún usuario en la base de datos, no es posible obtener un token):

1. Aplicar `rule_set/sql/users.sql` contra la base de datos.
2. Ejecutar `node rule_set/scripts/seed_user.mjs` para crear el primer usuario.
3. Definir `JWT_SECRET` en `rule_set/api/.env` (la API no arranca si falta).
4. Arrancar la API y el frontend.

Para el detalle técnico completo (estructura de la tabla, variables de entorno, lógica del interceptor Angular y el guard de rutas) consultar `CLAUDE.md § Autenticación y JWT`.

---

## 7. Contexto académico y autoría

- **Autor:** Jesús M. Broceño
- **Máster:** Desarrollo de Software potenciado con IA — BIG School
- **Tipo de entrega:** Trabajo Fin de Máster (TFM)

Este repositorio es una **versión anonimizada** del proyecto: los nombres y datos específicos de la
entidad bancaria se han sustituido por identificadores genéricos para poder publicarse como TFM.
