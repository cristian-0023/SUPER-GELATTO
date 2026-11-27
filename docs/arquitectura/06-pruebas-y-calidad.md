# 06 · Pruebas y calidad: el control de calidad de la heladería

## Para principiantes

Antes de abrir cada día, una heladería seria prueba sus helados: que la caja cobre bien, que el guardia no deje pasar a quien no tiene carnet, que no se venda un sabor agotado.
Las **pruebas automáticas** hacen eso con el código: son **3.389 pequeños "exámenes"** repartidos en 89 archivos, que se ejecutan solos en unos dos minutos.
Para no tocar la bodega de verdad, usan una **bodega de juguete**: una base Postgres (el programa de bases de datos que usa el proyecto) real pero en memoria (PGlite) y una Supabase falsa que responde como la de verdad.
Si un examen falla, algo se rompió y no se debe publicar.
La regla del equipo es "primero la prueba, después el código" (TDD): se escribe el examen, se ve fallar y luego se arregla el código hasta que pase.
Además, cada vez que alguien propone un cambio en GitHub, un **revisor automático** (CI) corre esos exámenes por su cuenta y la rama principal (`main`) está protegida para que nada entre sin pasarlos.

## Detalle técnico

### Cómo correrlas

```bash
cd backend
npm ci        # solo la primera vez
npm test      # = vitest run
```

- Configuración: `backend/vitest.config.mjs` (busca `tests/**/*.test.js`; tiempo de espera de 30 s porque PGlite tarda ~1 s en arrancar cada base).
- Resultado verificado el 2026-11-26 en `main` (después del PR #25): **89 archivos, 3.389 pruebas, todas en verde**, unos 2 minutos.
- No necesitan internet, ni Supabase, ni llaves reales: todo lo externo es falso.
- Aviso: aunque las pruebas viven en `backend/tests/`, **también cubren utilidades del frontend** (carpeta `tests/frontend/`). Las pantallas en sí (componentes React) no tienen pruebas.

### Integración continua (CI) y rama protegida

- `.github/workflows/ci.yml` corre en cada pull request hacia `main` y en cada commit de `main` con dos revisiones: `backend` (`npm ci` y `npm test`) y `frontend` (`npm ci` y `npx vite build`, que comprueba que la página compila). Detalle en [docs/CI.md](../CI.md).
- No usa secretos: las pruebas usan la Supabase falsa y PGlite.
- La rama `main` está protegida por una regla de GitHub ("Proteger main", activa): los cambios llegan por pull request y los checks `backend` y `frontend` se exigen por nombre. Los nombres de los jobs de `ci.yml` y los de la regla deben cambiarse juntos.

### Herramientas de prueba

| Herramienta | Para qué | Dónde |
|---|---|---|
| **Vitest** | Ejecuta las pruebas | `backend/package.json` (`"test": "vitest run"`) |
| **PGlite** | Postgres real en memoria: prueba las migraciones y las funciones SQL (`registrar_venta`, `cambiar_estado_venta`, Super Points, helado personalizado) sin Docker | `backend/tests/db/helpers.js` |
| **supertest** | Hace peticiones HTTP a la API Express sin abrir un puerto | `backend/tests/api/*.test.js` |
| **fakeSupabase** | Supabase falsa: nunca lanza excepciones (devuelve `{ data, error }` como la real), rechaza columnas inexistentes con el error real `PGRST204` y anota cada llamada | `backend/tests/helpers/fakeSupabase.js` |
| **cargarServidor** | Carga `server.js` con la Supabase falsa ya puesta (y variables de entorno ficticias para no caer en el modo simulado) | `backend/tests/helpers/cargarServidor.js` |
| Ayudantes de modelos 3D y catálogo | Construyen archivos GLB mínimos, un lector estricto de GLB y el catálogo real para las pruebas | `backend/tests/helpers/` (`modeloGlb.js`, `leerGlb.js`, `catalogoReal.js`) |

### Qué cubre cada carpeta

| Carpeta | Archivos | Pruebas | Qué comprueba |
|---|---|---|---|
| `tests/db/` | 9 | 203 | Migraciones y funciones SQL en un Postgres real: `registrar_venta`, Super Points, nivel por saldo, helado personalizado, estado y modelo 3D en la base, bucket `modelos-3d`, Storage de helados, tokens de recuperación y seguridad de tablas (RLS) |
| `tests/api/` | 52 | 2.767 | Rutas de la API Express con supertest y la Supabase falsa, y los módulos del chatbot |
| `tests/frontend/` | 28 | 419 | Funciones puras de la Tienda web (`frontend/src/utils/`) y reglas del panel y del chat |
| **Total** | **89** | **3.389** | |

### Por tema

| Tema | Archivos | Pruebas | Ejemplos de lo que asegura |
|---|---|---|---|
| **Chatbot Gelbot** (servidor) | 12 `tests/api/chatbot*.test.js` | 1.879 | Clientes y visitantes reciben solo textos del servidor; el modelo solo elige un tema; ingredientes y alérgenos solo de la ficha; nada se agrega sin intención clara ni tras una negación; tarjetas con foto; modelo y llave (`GROQ_MODEL`); confirmación de acciones del admin; limpieza del texto |
| Chat en la página | `panelGelbot`, `tarjetasGelbot` en `tests/frontend/` | 66 | Medidas del panel en escritorio y celular, teclado, tarjetas accesibles |
| Productos, panel y fichas | `editorProductos*`, `crearProductoValidacion`, `ocultarProducto`, `cacheProductos`, `productos`, `estadoEnBase`, `datosSabores` y sus pares del frontend | 391 (13 archivos) | Reglas compartidas de alta y edición, ocultar o mostrar, estado en la base, caché del catálogo |
| Modelos 3D | `modelos3dStorage`, `modelosTripoStorage`, `tripoFrenos`, `tripoSinLlave`, `db/modelo_3d`, `db/bucketModelos3d`, `frontend/modelos3d` y afines | 266 (12 archivos) | Copia del GLB al bucket sin riesgos de red interna, tope de tiempo y tamaño, un solo modelo generándose a la vez, límite de generaciones por hora |
| Super Points y pagos | `superPoints`, `pagos`, `pagoConSesion`, `limitePagos`, `db/super_points`, `db/nivel_por_saldo`, `db/registrar_venta` | 246 (10 archivos) | Saldo, nivel por saldo, canje, devolución al cancelar, todo o nada, stock |
| Helado personalizado | `heladoPersonalizado`, `db/helado_personalizado`, `frontend/personalizado` | 113 (3 archivos) | Precio puesto por la base, composición guardada, no se edita desde el panel |
| Cuentas y seguridad | `cuentasSeguridad`, `seguridadJwt`, `googleLogin`, `crearAdmin`, `ascensoAdmin`, `borrarUsuario`, `correosReservados`, `sesionAlRegistrarse`, `recuperarContrasena`, `limite*`, `endurecerAcceso`, `loginComodines` y afines | 302 (23 archivos) | Tokens, permisos por rol, solo el super admin asciende, sesión al registrarse, recuperar contraseña, límites de intentos |

### Qué **no** está cubierto

- La Tienda web no tiene pruebas de pantallas (componentes React): solo funciones puras de `utils/`.
- No hay pruebas contra los servicios reales (Google, Groq, AWS, Tripo, SMTP): se usan dobles falsos.
- Falta cobertura medida (no hay informe de cobertura) y no hay un revisor de estilo (linter) configurado.
- Algunas pruebas dependen de tiempos reales y pueden ser frágiles en una máquina muy cargada.

### Reglas de calidad del equipo

1. Una rama por cambio (`feat/...`, `fix/...`, `docs/...`); nunca directo en `main`.
2. TDD: prueba roja → código mínimo → verde → limpiar. En el historial, cada arreglo va precedido de un commit de la prueba en rojo.
3. Antes de unir: correr **todas** las pruebas (el CI también lo hace) y pasar una revisión de código (y de seguridad si toca datos, login o pagos).
