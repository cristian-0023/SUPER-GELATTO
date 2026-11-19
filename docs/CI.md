# Integración continua (CI)

El archivo `.github/workflows/ci.yml` es un **revisor automático**: cada vez que alguien abre o
actualiza un pull request hacia `main`, o cuando llega un commit a `main`, GitHub revisa el proyecto
solo y muestra una luz verde o roja. Nadie tiene que acordarse de correr las pruebas a mano.

## Qué revisa

| Check | Qué hace | Tiempo aproximado |
|---|---|---|
| `backend` | `npm ci` y `npm test` en `backend/`: las 1204 pruebas del servidor, de la base (PGlite) y de las utilidades del frontend (`backend/tests/frontend`). | 2 a 4 min |
| `frontend` | `npm ci` y `npx vite build` en `frontend/`: comprueba que la aplicación compila. | 1 min |

- Usa Node 22 (LTS) y las versiones exactas de los `package-lock.json`.
- **No usa secretos.** Las pruebas usan un Supabase falso y un Postgres en memoria; no tocan la base
  real, ni Google, ni Groq, ni Tripo, ni el correo.
- Si subes un commit nuevo al mismo PR, la corrida vieja se cancela y empieza otra.

## Cómo leer los checks

1. Abre el pull request en GitHub y baja hasta el recuadro de checks (o la pestaña **Checks**).
2. Verde en `backend` y `frontend`: todo bien, se puede revisar y unir.
3. Rojo: pulsa **Details** en el check que falló.
   - En `backend`, el paso `npm test` muestra qué prueba falló (archivo y nombre de la prueba).
   - En `frontend`, el paso `npx vite build` muestra el error de compilación (por ejemplo, un import
     que no existe).
4. Corrige en tu rama y haz push: el check vuelve a correr solo.
5. Para repetir una corrida sin cambiar código (por ejemplo, si GitHub tuvo un problema), usa
   **Re-run jobs** en la pestaña **Actions**.

## Importante

- Los nombres `backend` y `frontend` se exigen en la protección de `main` (CI-002). Si se cambian en
  `ci.yml`, hay que cambiarlos también en la regla de la rama.
- Para reproducir el check en tu equipo: `cd backend && npm ci && npm test` y
  `cd frontend && npm ci && npx vite build`.
