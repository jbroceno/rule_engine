---
name: dnf-json-rules
description: Implementa, valida y prueba motores de reglas DNF en Node.js usando configuración JSON.
---

# DNF JSON Rules Skill

## Cuándo usar esta skill
Úsala cuando el repositorio trate sobre:
- rule engines
- policy engines
- evaluación declarativa
- reglas JSON
- condiciones AND/OR
- explainability de decisiones

## Qué hacer
1. Verificar si el modelo actual representa realmente una DNF.
2. Separar:
   - esquema,
   - validación,
   - evaluación,
   - operadores,
   - trazas.
3. Añadir o mejorar:
   - validación estructural,
   - validación semántica,
   - tests por operador,
   - tests por grupo,
   - trazabilidad.
4. Proponer formato JSON simple y consistente.

## Forma canónica recomendada
```json
{
  "version": 1,
  "groups": [
    {
      "name": "example",
      "all": [
        { "fact": "user.country", "op": "equals", "value": "ES" },
        { "fact": "user.age", "op": "gte", "value": 18 }
      ]
    }
  ]
}