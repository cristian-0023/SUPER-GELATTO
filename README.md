# Super Gelatto

**Super Gelatto** es una heladería artesanal en línea, hecha como **proyecto estudiantil** (los pagos son simulados y no se cobra dinero real). El cliente elige sabores o **arma su propio helado en 3D**, lo paga con la pasarela simulada, acumula **Super Points** y puede pedir ayuda a **Gelbot**, un asistente de chat. Los administradores manejan el catálogo, las ventas y los usuarios desde un panel.

Parte del trabajo se hizo con ayuda de asistentes de inteligencia artificial (Claude Code), siempre con revisión del equipo, pruebas automáticas y revisión de código.

> Para entender el proyecto sin ser programador, empieza por [Cómo se construyó el proyecto](./docs/como-se-construyo.md) y por la [arquitectura explicada con la analogía de la heladería](./docs/arquitectura/README.md).

---

## Qué puede hacer

- **Tienda y carrito:** catálogo de sabores con fichas (ingredientes, alérgenos y nutrición), carrito que se recuerda en el navegador y pedidos con historial.
- **Pagos simulados** estilo Wompi (PSE, Nequi y Botón Bancolombia). El precio y el total siempre los calcula la base de datos. Ver [la pasarela](./docs/PAYMENT_GATEWAY.md).
- **Super Points:** 1 punto por cada $100 pagados; cada punto vale $5 de descuento y el nivel (Lover, Fan, Pro, Master) depende del saldo.
- **Helado personalizado 3D:** armador con 17 piezas y precios de la base. Ver [modelos 3D](./docs/modelos-3d.md).
- **Gelbot:** a los clientes les responde solo con textos escritos por el servidor; la IA únicamente entiende qué piden. Ver [Gelbot](./docs/chatbot_documentation.md).
- **Cuentas:** registro con sesión iniciada, login con contraseña o con Google, recuperar contraseña por correo y, para administradores, [reconocimiento facial](./docs/reconocimiento-facial.md).
- **Panel de administración:** productos (crear, editar, ocultar o mostrar, modelos 3D con Tripo), estados de venta, usuarios y roles. Solo el super administrador asciende a otros administradores.

---

## Tecnologías

| Parte | Tecnología |
|---|---|
| Página (frontend) | React 19, Vite 8, Tailwind 4, React Router 7, Three.js con React Three Fiber, Framer Motion, Lucide |
| Servidor (backend) | Node.js, Express 4 |
| Base de datos y archivos | Supabase (Postgres con RLS y funciones SQL; Storage) |
| Servicios externos | Google Sign-In, Groq (Gelbot), AWS Rekognition (login facial de admins), Tripo 3D (modelos 3D), correo SMTP (nodemailer) |
| Publicación | Vercel (la página y la API, dos proyectos) |
| Pruebas y CI | vitest, supertest, PGlite y GitHub Actions |

---

## Estructura de carpetas

```
.
├── backend/            Servidor Express
│   ├── server.js         La API (35 rutas), guardias, límites, pagos y modelos 3D
│   ├── chatbot.js        Entrada de Gelbot y modo administrador
│   ├── gelbot*.js        Módulos del chat: intención, fichas, respuestas, menú, texto y flujo del cliente
│   ├── datosSabores.js   Fichas de los sabores
│   ├── modelos3dStorage.js  Copia de los modelos 3D al bucket modelos-3d
│   ├── imagenProducto.js, correoIlike.js   Utilidades pequeñas
│   ├── scripts/          Herramientas de mantenimiento (AWS, administradores)
│   ├── tests/            Pruebas: api/, db/, frontend/ y helpers/
│   └── vercel.json       Cron diario que despierta la base gratuita
├── frontend/           La página (Vite + React)
│   ├── src/              pages/, components/, context/, utils/
│   └── public/           Imágenes, video y los modelos 3D del armador (360/)
├── supabase/           Base de datos
│   ├── schema_base_2026-10-25.sql   Foto de las tablas
│   ├── migrations/       Cambios de la base (se aplican a mano en el SQL Editor)
│   └── rollbacks/        Cómo deshacer cada migración
├── docs/               Documentación
│   ├── arquitectura/     Modelo C4 (01 a 08) y figuras Anatomy
│   ├── chatbot_documentation.md, modelos-3d.md, reconocimiento-facial.md, como-se-construyo.md
│   ├── CI.md, PAYMENT_GATEWAY.md
│   └── superpowers/      Especificaciones y planes de varios cambios
├── .github/workflows/  CI (ci.yml)
├── VALIDATIONS.md      Reglas de validación del registro
└── migration.sql       Script antiguo de limpieza de la base (histórico)
```

---

## Cómo correrlo en tu computador

Se recomienda Node.js 22 (la versión que usa el CI).

### 1. Servidor

```bash
cd backend
npm ci
cp .env.example .env      # completa los valores; este archivo NO se sube a git
npm start                 # escucha en el puerto 5000
```

Variables principales (solo nombres; los valores te los da el equipo): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` (mínimo 32 caracteres), `GOOGLE_CLIENT_ID`, `GROQ_API_KEY`, `TRIPO_API_KEY`, `SMTP_*`, `ADMIN_EMAILS`, `SUPER_ADMIN_EMAIL` y `FRONTEND_URL`. La lista completa y cuáles son obligatorias está en [03-contenedores.md](./docs/arquitectura/03-contenedores.md#variables-de-entorno-solo-nombres). Sin la configuración de Supabase el servidor arranca en un **modo simulado** solo para desarrollo.

### 2. Página

```bash
cd frontend
npm ci
cp .env.example .env      # VITE_API_URL y VITE_GOOGLE_CLIENT_ID
npm run dev               # http://localhost:3000 (reenvía /api al servidor)
```

### 3. Probarlo

```bash
cd backend && npm test                 # 3.389 pruebas en 89 archivos, unos 2 minutos, sin internet ni llaves
cd frontend && npx vite build          # comprueba que la página compila (lo mismo que hace el CI)
```

Las pruebas usan una Supabase falsa y un Postgres en memoria (PGlite): no tocan la base real. Detalle en [06-pruebas-y-calidad.md](./docs/arquitectura/06-pruebas-y-calidad.md).

---

## Integración continua

Cada pull request hacia `main` (y cada commit en `main`) corre dos revisiones en GitHub Actions: `backend` (todas las pruebas con `npm test`) y `frontend` (compilación con `npx vite build`). La rama `main` está protegida: si una revisión falla, el cambio no se une. Verde = todo bien; rojo = pulsa **Details** para ver qué falló. Más en [docs/CI.md](./docs/CI.md).

---

## Documentación

| Quiero... | Lee |
|---|---|
| Entender todo el sistema con analogías | [Arquitectura (C4)](./docs/arquitectura/README.md) |
| Saber cómo se hizo y cómo contribuir | [Cómo se construyó el proyecto](./docs/como-se-construyo.md) |
| Entender el chat | [Gelbot](./docs/chatbot_documentation.md) |
| Entender lo 3D | [Modelos 3D](./docs/modelos-3d.md) |
| Entender el login con la cara | [Reconocimiento facial](./docs/reconocimiento-facial.md) |
| Ver cómo se prueba y publica | [Pruebas y calidad](./docs/arquitectura/06-pruebas-y-calidad.md) y [CI](./docs/CI.md) |
| Conocer el pago simulado | [Pasarela de pago](./docs/PAYMENT_GATEWAY.md) |
| Conocer la base de datos | [Modelo de datos](./docs/arquitectura/07-modelo-datos.md) |

---

## Licencia

Este proyecto es para fines educativos y demostrativos.
