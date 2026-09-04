# Bracket Manager (by Joseja)

Gestor web para torneos de Smash Ultimate que se conecta a start.gg. Pensado para que organizadores y competidores sigan sus sets de forma sencilla: iniciar partidas, reportar resultados y ver el estado de cada ronda.

## Que ofrece
- Ver eventos activos y navegar a sus sets (lista siempre en vivo desde start.gg).
- Iniciar un set y seguirlo con control de RPS, bans y formato BO3 o BO5. Se utiliza el ruleset oficial de SmashBrosSpain.
- Registrar y enviar el resultado para que lo revise un administrador.
- Posibilidad de revisar reportes de los jugadores para aprobarlos o rechazarlos y/o modificarlos en caso de que haya algún error o disputa.

## Como funciona
1) Elige un evento y abre la lista de sets disponibles.
2) Si eres admin, inicia el set y si participas en dicho set, empiezas el procedimiento del set.
3) Si eres player, esperas a que un admin inicie tu set y comienzas el procedimiento del mismo
4) Siguiendo el ruleset oficial de SmashBrosSpain, la app te guiará sobre el procedimiento de un set hasta que finalice el mismo.
5) Envía el reporte para que un admin lo valide.
6) Revisa el estado del set desde el dashboard: en progreso, pendiente de revision, aprobado o rechazado.

## Acceso
La aplicacion es web: basta con abrir el enlace publico que se proporcione (ej. dominio o GitHub Pages) y autenticarte con tu cuenta de start.gg. Desde alli veras tu panel con eventos y sets disponibles.

## Roles
- Administrador: puede iniciar sets, revisar y aprobar o rechazar reportes.
- Competidor: puede reportar sus propios sets a un administrador, y ver su estado, además de actualizar sets rechazados.

## Estructura del proyecto
```
bracket_manager/
├── backend/    # API y logica de sets/reportes
├── frontend/   # SPA para admin/competidores
└── docs/       # Contratos API, checklist deploy, seguridad, TODO
```

