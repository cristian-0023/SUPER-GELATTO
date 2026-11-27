# Cómo se construyó Super Gelatto

Una guía para los compañeros de clase: qué se hizo, en qué orden, con qué herramientas y cómo trabajar en el proyecto sin romper nada. Está sacada del historial real de `main` (`git log`) al 2026-11-26: **251 commits**, desde el 2026-04-20.

## Para principiantes: abrir una heladería, paso a paso

Construir esta app fue como **abrir una heladería de verdad**:

1. Primero se montó el **local básico**: un mostrador (la página), una cocina (el servidor) y una bodega (la base de datos).
2. Después se puso una **caja registradora** que cobra bien (el pago) y un **guardia** en la puerta (el inicio de sesión).
3. Luego se escribió el **manual de la heladería** (la documentación).
4. Más tarde llegaron las **novedades**: la tarjeta de puntos, las maquetas 3D, el helado personalizado y un mesero-chat.
5. Al final vino una **inspección** (la auditoría): un revisor recorrió el local con una lista, anotó lo que había que arreglar y el equipo lo fue corrigiendo, cambio por cambio, con un control de calidad automático en la puerta que no deja pasar nada que no esté probado.

## Detalle técnico

### Línea de tiempo

| Fecha | Etapa | Qué pasó |
|---|---|---|
| 2026-04-20 | **La base** | Primer commit ("Super Gelatto 2.0"). Abril a agosto (unos 55 commits): la página en React, el servidor Express con Supabase, el constructor de helados 3D, el inicio de sesión y la pasarela de pago simulada estilo Wompi (rama de agosto) |
| 2026-10-26 | **Unión y primera seguridad** | Se unieron las líneas de trabajo del equipo (PR #1 y #2) con un paquete de arreglos de seguridad y de pagos: `registrar_venta` como caja registradora en la base (migración del 2026-10-25) y confirmación de acciones en el chat |
| 2026-10-26 | **Documentación C4** | Los documentos de [arquitectura](arquitectura/README.md) y las figuras Anatomy (PR #3) |
| 2026-11-04 a 2026-11-11 | **Endurecer** | Seguridad de datos y tablas cerradas a la llave pública (PR #4), recuperar contraseña de punta a punta (PR #5 y #6), despertador diario y Vercel (PR #7), **Super Points** (PR #8), velocidad básica (PR #9) y editor de productos (PR #10) |
| 2026-11-18 | **Auditoría y arreglos** | Una auditoría técnica revisó el proyecto con una lista de hallazgos (con identificadores como `SEC-001`, `API-007`, `CI-001`). Salieron modelos 3D comprimidos (PR #11) y guardados en Storage (PR #12), validación al crear productos (PR #13), sesión al registrarse (PR #14), limpieza de menores (PR #15) y **CI con GitHub Actions** (PR #16) |
| 2026-11-19 | **Más arreglos** | Solo el super admin asciende a otros (PR #17), nivel de Super Points según el saldo (PR #18) y **helado personalizado 3D pagable** (PR #19) |
| 2026-11-20 a 2026-11-25 | **Gelbot** | Nuevo modelo de Groq (PR #20), acciones e imágenes (PR #21), rediseño del chat (PR #22), afinado de lo que entiende (PR #23) y, en el PR #24, **el cliente recibe solo textos escritos por el servidor** |
| 2026-11-26 | **Ocultar productos** | Ocultar o mostrar productos desde el panel (PR #25) |

De los 251 commits, 162 son de noviembre: casi todo lo que hoy hace la tienda es de ese mes.

### Tecnologías y por qué se eligió cada una

| Tecnología | Para qué | Por qué se eligió |
|---|---|---|
| **React 19, Vite 8, Tailwind 4, React Router 7** | La Tienda web (el mostrador) | React arma pantallas con piezas reutilizables; Vite arranca y compila muy rápido; Tailwind permite diseñar sin escribir mucho CSS; Router maneja las pantallas de una sola página |
| **Three.js (React Three Fiber)** | El armador de helados 3D y el visor de modelos | Es la forma estándar de mostrar 3D en el navegador |
| **Express (Node.js)** | La API (la cocina) | Sencillo, muy conocido y con mucha ayuda disponible; JavaScript en toda la app |
| **Supabase (Postgres)** | La base de datos y el almacenamiento de archivos | Da un Postgres real alojado, con **RLS** (reglas que cierran cada tabla a quien no debe verla) y permite poner el dinero, el stock y los puntos en **funciones SQL** que se ejecutan "todo o nada" |
| **Vercel** | Publicar la página y la API (dos proyectos) | Publica solo desde GitHub y tiene plan gratuito; un cron diario despierta la base gratuita (`/api/health`) |
| **Groq** | La IA de Gelbot (el intérprete) | Responde muy rápido; el modelo solo elige un tema, el servidor escribe los textos |
| **AWS Rekognition** | Reconocimiento facial de administradores | Compara caras como servicio, sin entrenar nada propio |
| **Tripo 3D** | Generar modelos 3D de productos desde un texto | Genera maquetas 3D sin modelar a mano |
| **Google Sign-In** | Entrar con Google | Evita guardar contraseñas de quien no quiere crear una |
| **vitest, supertest, PGlite** | Las pruebas | vitest corre las pruebas, supertest llama a la API sin abrir un puerto y PGlite es un Postgres real en memoria para probar las funciones SQL sin tocar la base de verdad |
| **GitHub Actions** | El revisor automático (CI) | Corre las pruebas y la compilación en cada propuesta de cambio, gratis y sin secretos |

### Cómo correrlo en tu computador

Se recomienda Node.js 22 (es la versión que usa el CI) y git. Desde la raíz del repositorio:

```bash
# 1. Servidor
cd backend
npm ci
cp .env.example .env     # abre .env y completa los valores (nunca los subas a git)
npm start                # escucha en el puerto 5000

# 2. Página (en otra terminal)
cd frontend
npm ci
cp .env.example .env     # VITE_API_URL y VITE_GOOGLE_CLIENT_ID
npm run dev              # http://localhost:3000, reenvía /api al servidor
```

- `backend/.env.example` y `frontend/.env.example` solo traen **nombres** de variables; los valores te los da el equipo y **no se escriben en el código ni en documentos**. Las variables de AWS (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `REKOGNITION_COLLECTION_ID`) no están en el ejemplo; solo hacen falta para el login facial.
- Sin la configuración de Supabase, el servidor arranca en **modo simulado** (una base de mentira en memoria, solo para desarrollo). En producción no arranca así.
- Sin `GROQ_API_KEY`, Gelbot igual responde con sus palabras clave.
- **Pruebas:** `cd backend && npm test` (3.389 pruebas, unos 2 minutos, sin internet ni llaves reales). Ver [06-pruebas-y-calidad.md](arquitectura/06-pruebas-y-calidad.md).
- **Compilar la página como lo hace el CI:** `cd frontend && npx vite build`.

### La forma de trabajar

1. **Una rama por cambio** (`feat/...`, `fix/...`, `docs/...`, `perf/...`, `chore/...`). Nunca se trabaja directo en `main`.
2. **TDD** ("primero la prueba"): se escribe la prueba, se ve **fallar** (rojo), se escribe el código mínimo para que pase (verde) y se limpia. En el historial se ve: un commit `test: ... (rojo)` y después el `fix:` que lo arregla.
3. **Revisión** antes de unir: se corren todas las pruebas, un compañero revisa el código y, si toca datos, login o pagos, también una revisión de seguridad.
4. **CI que bloquea:** GitHub Actions corre `backend` (`npm test`) y `frontend` (`vite build`) en cada pull request. La rama `main` está protegida con una regla de GitHub: si un check falla, no se une. Detalle en [CI.md](CI.md).
5. **Publicación:** al unirse a `main`, Vercel publica la página y la API. (Esa conexión está configurada en el panel de Vercel, no en el repositorio.)
6. **La base de datos se toca a mano y con cuidado:** los cambios van como **migraciones** en `supabase/migrations/` (cada una con su `rollback` en `supabase/rollbacks/`) y **una persona las aplica en el SQL Editor de Supabase**, antes de publicar el código que las usa.
7. Los commits y los documentos van en español. Nunca se suben contraseñas, llaves ni datos de personas.

### Cómo contribuir sin romper nada

Ejemplo: quieres agregar algo nuevo.

1. **Actualiza y crea tu rama:** `git fetch origin` y `git checkout -b feat/mi-cambio origin/main`.
2. **Piensa antes de programar:** escribe en 5 líneas qué quieres lograr y qué tablas, rutas y pantallas toca. Para algo grande, escribe una mini-especificación en `docs/superpowers/specs/`.
3. **Si toca la base:** crea una migración con fecha en `supabase/migrations/` y su `rollback`; que sea **idempotente** (se puede ejecutar dos veces) y que no dé permisos a `anon` ni `authenticated`. Escribe primero la prueba en `backend/tests/db/`.
4. **Escribe la prueba que falla:** en `backend/tests/api/` (rutas, con la Supabase falsa) o `backend/tests/frontend/` (funciones puras de `frontend/src/utils/`). Corre `npm test` y comprueba que falla por la razón correcta.
5. **Escribe el código mínimo** hasta que pase. Valida todo lo que entra **en el servidor**, nunca confíes en precios ni roles que mande la página, y no pongas llaves en el código.
6. **Corre todo:** `cd backend && npm test` y `cd frontend && npx vite build`.
7. **Commits chicos y en español** (`feat:`, `fix:`, `test:`, `docs:`), sin datos personales ni secretos.
8. **Abre un pull request hacia `main`**, explica qué cambió y cómo se probó, y espera el CI en verde y la revisión de un compañero.
9. **Si cambiaste cómo funciona algo, actualiza la documentación** en `docs/` y revisa que los enlaces sigan funcionando. Prefiere citar nombres de funciones o rutas en vez de números de línea, que cambian con cada PR.
10. **Después de unir:** si hay migración, pide que la apliquen en Supabase y comprueba la página publicada.

Si algo falla, no lo ocultes: pregunta. Lo más caro de este proyecto fue siempre un error silencioso, no uno visible.

Más: [README del proyecto](../README.md), [arquitectura](arquitectura/README.md), [Gelbot](chatbot_documentation.md), [modelos 3D](modelos-3d.md) y [reconocimiento facial](reconocimiento-facial.md).
