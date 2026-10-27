# 06 · Pruebas y calidad: el control de calidad de la heladería

## Para principiantes

Antes de abrir cada día, una heladería seria prueba sus helados: que la caja cobre bien, que el guardia no deje pasar a quien no tiene carnet, que no se venda un sabor agotado.
Las **pruebas automáticas** hacen eso con el código: son 322 pequeños "exámenes" que se ejecutan solos en un minuto y medio.
Para no tocar la bodega de verdad, usan una **bodega de juguete**: una base Postgres (el programa de bases de datos que usa el proyecto) real pero en memoria (PGlite) y una Supabase falsa que responde como la de verdad.
Si un examen falla, algo se rompió y no se debe publicar.
La regla del equipo es "primero la prueba, después el código" (TDD): se escribe el examen, se ve fallar y luego se arregla el código hasta que pase.

## Detalle técnico

### Cómo correrlas

```bash
cd backend
npm ci        # solo la primera vez
npm test      # = vitest run
```

- Configuración: `backend/vitest.config.mjs` (busca `tests/**/*.test.js`; tiempo de espera de 30 s porque PGlite tarda ~1 s en arrancar cada base).
- Resultado verificado en `69f7fac`: **20 archivos, 322 pruebas, todas en verde** (~90 s).
- No necesitan internet, ni Supabase, ni llaves reales: todo lo externo es falso.

### Herramientas de prueba

| Herramienta | Para qué | Dónde |
|---|---|---|
| **Vitest** | Ejecuta las pruebas | `backend/package.json` (`"test": "vitest run"`) |
| **PGlite** | Postgres real en memoria: prueba la migración y `registrar_venta` sin Docker | `backend/tests/db/helpers.js` |
| **supertest** | Hace peticiones HTTP a la API Express sin abrir un puerto | `backend/tests/api/*.test.js` |
| **fakeSupabase** | Supabase falsa: nunca lanza excepciones (devuelve `{ data, error }` como la real), rechaza columnas inexistentes con el error real `PGRST204` y anota cada llamada. Sus columnas salen del esquema y las migraciones, así no se desactualiza | `backend/tests/helpers/fakeSupabase.js` |
| **cargarServidor** | Carga `server.js` con la Supabase falsa ya puesta (y variables de entorno ficticias para no caer en el modo simulado) | `backend/tests/helpers/cargarServidor.js` |

### Qué cubre cada carpeta

| Carpeta | Archivos | Pruebas | Qué comprueba |
|---|---|---|---|
| `tests/db/` | 1 | 37 | La migración `20261025120000` y `registrar_venta` en un Postgres real |
| `tests/api/` | 18 | 282 | Rutas de la API Express con supertest y la Supabase falsa |
| `tests/frontend/` | 1 | 3 | Función pura `soloVentasCobradas` de la Tienda web |
| **Total** | **20** | **322** | |

### Detalle por archivo

| Archivo | Pruebas | Qué asegura |
|---|---|---|
| `db/registrar_venta.test.js` | 37 | Columnas y CHECK nuevos; precio de la base; todo o nada; stock; códigos de error; solo `service_role` puede ejecutarla |
| `api/pagos.test.js` | 44 | Forma de la respuesta del pago; aprobado/rechazado; cada código de error de la base → HTTP correcto (409, 400, 500) y mensaje en español |
| `api/chatbotConfirmacion.test.js` | 37 | Acciones de Gelbot con confirmación, tope de herramientas, datos no confiables, resumen de ventas paginado |
| `api/cuentasSeguridad.test.js` | 26 | `PUT /api/users/:id`: dueño o admin, lista blanca de campos, correo repetido, protección del super admin |
| `api/chatbotSeguridad.test.js` | 22 | Identidad solo por token; herramientas de admin solo para admins; validación; límite de mensajes |
| `api/crearAdmin.test.js` | 21 | Solo el super admin crea admins; validación; 409; sin `password_hash`; límite |
| `api/seguridadJwt.test.js` | 19 | Tokens HS256 de 24 h, secreto obligatorio y guardias de las rutas de admin |
| `api/pedidosSeguridad.test.js` | 18 | Historial con sesión, dueño o admin, paginado; rutas viejas eliminadas; modelo 3D solo admin |
| `api/estadoVenta.test.js` | 15 | Cambio de estado acepta exactamente los 9 estados; 500 si la base falla |
| `api/googleLogin.test.js` | 14 | Verificación del token de Google, `email_verified`, 503 sin `GOOGLE_CLIENT_ID`, elevación por `ADMIN_EMAILS` |
| `api/limiteLogin.test.js` | 14 | Límite de las rutas de cuenta (429); cuerpo de 1 MB / 8 MB (413); sesión antes del cuerpo grande |
| `api/productos.test.js` | 13 | Rutas de admin de productos |
| `api/endurecimiento.test.js` | 12 | Ingresos del dashboard solo con ventas cobradas; "base primero"; id de producto que da la base |
| `api/correosReservados.test.js` | 11 | Correos de admin no se registran; al elevar con Google se invalida la contraseña |
| `api/correoEstado.test.js` | 5 | Correo de cambio de estado escapado; solo si la base guardó |
| `api/produccion.test.js` | 4 | En producción no arranca sin Supabase |
| `api/modoSimulado.test.js` | 3 | El modo simulado responde igual que `registrar_venta` |
| `frontend/ingresos.test.js` | 3 | `ESTADOS_COBRADOS` de la página = el del servidor |
| `api/chatbotSuperAdmin.test.js` | 2 | El super admin de Gelbot sale de `SUPER_ADMIN_EMAIL` |
| `api/limitePagos.test.js` | 2 | Límite de intentos del pago |

### Qué **no** está cubierto

- La Tienda web no tiene pruebas de pantallas (solo `ingresos.js`). Los desajustes de [05-componentes-frontend.md](05-componentes-frontend.md#desajustes-entre-la-página-y-el-servidor) no los detecta ninguna prueba.
- No hay pruebas contra los servicios reales (Google, Groq, AWS, Tripo, SMTP): se usan dobles falsos.
- Ninguna prueba toca `POST /api/reset-password/:token` (ruta 7). `POST /api/forgot-password` (ruta 6) y las rutas de rostro (3 y 4) solo se prueban en su límite de intentos y tamaño de cuerpo (`limiteLogin.test.js`), y `GET /api/products` (ruta 22) solo de paso (`endurecimiento.test.js`).

### Reglas de calidad del equipo

1. Una rama por cambio (`feat/...`, `fix/...`, `docs/...`); nunca directo en `main`.
2. TDD: prueba roja → código mínimo → verde → limpiar.
3. Antes de unir: correr **todas** las pruebas y pasar una revisión de código (y de seguridad si toca datos, login o pagos).
