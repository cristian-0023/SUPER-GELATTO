# Integración continua (CI)

El archivo `.github/workflows/ci.yml` es un **revisor automático**: cada vez que alguien abre o
actualiza un pull request hacia `main`, o cuando llega un commit a `main`, GitHub revisa el proyecto
solo y muestra una luz verde o roja. Nadie tiene que acordarse de correr las pruebas a mano.

## Qué revisa

| Check | Qué hace | Tiempo aproximado |
|---|---|---|
| `backend` | `npm ci` y `npm test` en `backend/`: las 3419 pruebas (90 archivos) del servidor, de la base (PGlite) y de las utilidades del frontend (`backend/tests/frontend`). | unos 2 a 4 min |
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

## Cómo comprobar que el CI funciona (criterio de aceptación)

1. **Verde:** en un PR sano, `backend` y `frontend` salen en verde en menos de unos 8 minutos.
2. **Rojo en `backend`:** en una rama de prueba que se borra después, agrega `expect(1).toBe(2)`
   dentro de cualquier prueba del backend y abre un PR: `backend` debe salir en rojo. Quita la línea,
   haz push y debe volver a verde.
3. **Rojo en `frontend`:** en otra rama de prueba, agrega un `import` de un archivo que no existe en
   cualquier componente: `frontend` debe salir en rojo.
4. El flujo usa `npm ci` con los lockfiles y no usa ningún secreto del repositorio.

## Importante

- Los nombres `backend` y `frontend` se exigen en la protección de `main` (CI-002). Si se cambian en
  `ci.yml`, hay que cambiarlos también en la regla de la rama.
- Para reproducir el check en tu equipo: `cd backend && npm ci && npm test` y
  `cd frontend && npm ci && npx vite build`.
