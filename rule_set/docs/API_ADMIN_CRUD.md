# API Admin CRUD (OpenAPI-lite)

## 1. Alcance

Contrato propuesto para la fase CRUD de configuracion de reglas y parametros del motor DNF.

- Base URL: `/api`
- Content-Type: `application/json`
- Formato de error:

```json
{
  "message": "Texto del error",
  "details": {}
}
```

Codigos esperados:
- `200` OK
- `201` Created
- `400` Validacion
- `404` No encontrado
- `409` Conflicto
- `500` Error interno

---

## 2. Schemas de referencia

### RuleCondition

```json
{
  "group_id": 1,
  "left_operand": "edadMax",
  "operator": "LTE",
  "right_operand": "PARAM:EDAD_MAX",
  "value_type": "NUMBER"
}
```

### RuleAction

```json
{
  "action_type": "SET_DICTAMEN",
  "action_payload": {
    "dictamen": "APTA"
  },
  "stop_processing": true
}
```

### Rule

```json
{
  "rule_id": 101,
  "offerCode": "HJ_A",
  "stage": "PRE",
  "rule_name": "PRE edad maxima",
  "priority": 900,
  "enabled": true,
  "action": {
    "action_type": "SET_DICTAMEN",
    "action_payload": {},
    "stop_processing": false
  },
  "conditions": []
}
```

### ParamValue

```json
{
  "key": "EDAD_MAX",
  "value": "35",
  "value_type": "NUMBER"
}
```

### OfferStageParams

```json
{
  "offerCode": "HJ_A",
  "stage": "PRE",
  "paramValues": [
    {
      "key": "EDAD_MAX",
      "value": "35",
      "value_type": "NUMBER"
    }
  ]
}
```

---

## 3. Endpoints de reglas

### GET `/api/admin/rules`

Filtros soportados:
- `offerCode`
- `stage`
- `enabled`
- `q`
- `page`
- `pageSize`

Ejemplo:

`GET /api/admin/rules?offerCode=HJ_A&stage=PRE&enabled=true&q=edad&page=1&pageSize=50`

Respuesta `200`:

```json
{
  "items": [
    {
      "rule_id": 101,
      "offerCode": "HJ_A",
      "stage": "PRE",
      "rule_name": "PRE edad maxima",
      "priority": 900,
      "enabled": true,
      "action": {},
      "conditions": []
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 1
  }
}
```

### POST `/api/admin/rules`

Body:

```json
{
  "offerCode": "HJ_A",
  "stage": "PRE",
  "rule_name": "PRE edad maxima",
  "priority": 900,
  "enabled": true,
  "action": {
    "action_type": "SET_DICTAMEN",
    "action_payload": {
      "dictamen": "APTA"
    },
    "stop_processing": false
  },
  "conditions": [
    {
      "group_id": 1,
      "left_operand": "edadMax",
      "operator": "LTE",
      "right_operand": "PARAM:EDAD_MAX",
      "value_type": "NUMBER"
    }
  ]
}
```

Respuesta `201`:

```json
{
  "rule_id": 101
}
```

### PUT `/api/admin/rules/:ruleId`

Actualizacion completa del recurso.

Respuesta `200`:

```json
{
  "rule_id": 101,
  "updated": true
}
```

### DELETE `/api/admin/rules/:ruleId`

Respuesta `200`:

```json
{
  "rule_id": 101,
  "deleted": true
}
```

### PATCH `/api/admin/rules/:ruleId/enabled`

Body:

```json
{
  "enabled": false
}
```

Respuesta `200`:

```json
{
  "rule_id": 101,
  "enabled": false
}
```

### PATCH `/api/admin/rules/reorder`

Body:

```json
{
  "offerCode": "HJ_A",
  "stage": "PRE",
  "items": [
    {
      "rule_id": 101,
      "priority": 950
    },
    {
      "rule_id": 102,
      "priority": 940
    }
  ]
}
```

Respuesta `200`:

```json
{
  "updated": 2
}
```

---

## 4. Endpoints de parametros

### GET `/api/admin/params`

Filtros:
- `offerCode`
- `stage`

Ejemplo:

`GET /api/admin/params?offerCode=HJ_A&stage=PRE`

Respuesta `200`:

```json
{
  "items": [
    {
      "offerCode": "HJ_A",
      "stage": "PRE",
      "paramValues": [
        {
          "param_id": 301,
          "key": "EDAD_MAX",
          "value": "35",
          "value_type": "NUMBER"
        }
      ]
    }
  ]
}
```

### POST `/api/admin/params`

Body:

```json
{
  "offerCode": "HJ_A",
  "stage": "PRE",
  "key": "EDAD_MAX",
  "value": "35",
  "value_type": "NUMBER"
}
```

Respuesta `201`:

```json
{
  "param_id": 301
}
```

### PUT `/api/admin/params/:paramId`

Body:

```json
{
  "value": "36",
  "value_type": "NUMBER"
}
```

Respuesta `200`:

```json
{
  "param_id": 301,
  "updated": true
}
```

### DELETE `/api/admin/params/:paramId`

Respuesta `200`:

```json
{
  "param_id": 301,
  "deleted": true
}
```

---

## 5. Endpoint de prevalidacion

### POST `/api/admin/validate`

Body:

```json
{
  "entity": "rule",
  "payload": {
    "offerCode": "HJ_A",
    "stage": "PRE",
    "rule_name": "PRE edad maxima",
    "priority": 900,
    "enabled": true,
    "action": {
      "action_type": "SET_DICTAMEN",
      "action_payload": {},
      "stop_processing": false
    },
    "conditions": []
  }
}
```

Respuesta `200`:

```json
{
  "valid": false,
  "errors": [
    {
      "field": "conditions",
      "message": "Debe contener al menos una condicion."
    }
  ],
  "warnings": []
}
```

---

## 6. Reglas de validacion obligatoria

- `stage` en `PRE | FINAL`
- `value_type` en `NUMBER | BOOL | STRING | JSON`
- `operator` permitido por el motor DNF actual
- `offerCode` obligatorio, string no vacio
- `priority` entero
- `group_id` entero mayor o igual que 0
- `conditions` requerido en create/update (salvo excepcion funcional explicita)
- `right_operand`:
  - literal coherente con `value_type`, o
  - referencia `PARAM:<KEY>` con `KEY` no vacio
- `action_type` permitido por motor
- `action_payload` con shape valido segun `action_type`

Unicidad recomendada:
- Regla: (`offerCode`, `stage`, `rule_name`) si negocio lo requiere
- Parametro: (`offerCode`, `stage`, `key`) obligatorio para evitar duplicados

---

## 7. Notas de implementacion (PR1)

- Implementar rutas bajo `/api/admin` sin romper rutas actuales de simulacion.
- Reusar formato de errores del middleware existente (`message`, `details`).
- Mantener contratos JSON actuales consumidos por el engine (`offers`, `params`, `paramValues`).

---

## 8. Coleccion Postman

Coleccion lista para pruebas manuales:

- `rule_set/docs/API_ADMIN_CRUD.postman_collection.json`

Incluye requests para:
- Health
- Rules CRUD
- Params CRUD
- Validate (caso valido e invalido)
