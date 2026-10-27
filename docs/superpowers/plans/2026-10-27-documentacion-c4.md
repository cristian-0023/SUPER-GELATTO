# Documentación C4 de SUPER-GELATTO — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Documentar la app completa con el modelo C4 en `docs/arquitectura/`, verificada contra el código real de `main` (69f7fac), con explicación para principiantes al inicio de cada capa, diagramas Mermaid y 2 figuras Anatomy.

**Architecture:** Dos ramas en paralelo sin archivos compartidos: `docs/arquitectura-c4` (textos + Mermaid, archivos 00–08) y `docs/figuras-anatomy` (figuras en `docs/arquitectura/figuras/`). Se unen en `docs/arquitectura-c4`, un revisor contrasta cada dato con el código y el usuario aprueba el PR (repo oficial cristian-0023/SUPER-GELATTO).

**Tech Stack:** Markdown (GitHub), Mermaid (flowchart/C4, erDiagram, sequenceDiagram, stateDiagram), skill Anatomy (Node 20.10+, SVG/HTML).

**Spec:** índice aprobado por el usuario el 2026-10-27 (en la conversación; copiado en la sección "Índice" abajo).

## Global Constraints
- Idioma: español, para un usuario NO técnico al inicio de cada capa (frases cortas, analogías de la heladería), detalle técnico después.
- Fuente de verdad: el código de `main` 69f7fac (`backend/server.js`, `backend/chatbot.js`, `frontend/src/**`, `supabase/**`). Los documentos viejos (`README.md`, `VALIDATIONS.md`, `docs/PAYMENT_GATEWAY.md`, `docs/chatbot_documentation.md`, `frontend/README.md`) NO son fuente; se listan con su estado (vigente / desactualizado / qué falla).
- Cada afirmación técnica concreta (ruta, permiso, tabla, columna, variable de entorno, límite) debe poder señalarse en el código (`archivo:línea` en una nota o tabla).
- Repo PÚBLICO: ningún secreto, correo personal, ID de proyecto Supabase, contraseña ni valor real de variable de entorno. Solo nombres de variables.
- Diagramas Mermaid que GitHub renderice (validar sintaxis); máximo ~15 nodos por diagrama; mismos nombres de piezas en todos los niveles.
- Commits en español con prefijo `docs:`, sin Co-Authored-By ni atribución a Claude. Sin push ni merge.

## Índice (spec)
0 `README.md` — qué es C4, cómo leer, glosario, estado de documentos viejos, figura Anatomy "la heladería como máquina".
1 `01-negocio.md` — qué vende, roles (visitante, cliente, admin, super admin), permisos, reglas de precio/stock/estados de venta (9 estados).
2 `02-contexto.md` — C4 nivel 1 con sistemas externos: Supabase, Google, Groq, AWS Rekognition, Tripo 3D, correo (nodemailer), Render, Vercel.
3 `03-contenedores.md` — C4 nivel 2: SPA React/Vite (Vercel), API Express (Render), Postgres (Supabase); variables de entorno; despliegue.
4 `04-componentes-backend.md` — C4 nivel 3: módulos lógicos del servidor; tabla de las 26 rutas (método, ruta, quién puede, qué hace, límite de intentos); seguridad.
5 `05-componentes-frontend.md` — C4 nivel 3: pantallas, componentes, CartContext, utils/api.js.
6 `06-pruebas-y-calidad.md` — 322 pruebas: qué cubre cada carpeta y cómo correrlas.
7 `07-modelo-datos.md` — ER de las 9 tablas, columnas clave, `registrar_venta`, índices, permisos.
8 `08-flujos.md` — secuencias: compra; login (contraseña, Google, facial); recuperar contraseña; cambio de estado + correo; chatbot con confirmación; producto con modelo 3D; figura Anatomy "el viaje de una compra".

## Review Focus
- Rutas o permisos documentados distintos del código (p. ej. una ruta admin descrita como pública) → el revisor cruza la tabla del doc 04 con `server.js` línea por línea.
- Diagramas Mermaid que no renderizan en GitHub → validar con `npx -y @mermaid-js/mermaid-cli` o equivalente.
- Datos sensibles colados (correos, URL del proyecto Supabase, valores de env) → `git grep` en `docs/`.
- Un principiante no entiende la introducción de una capa → cada capa abre con 1 analogía y sin siglas sin explicar.
- Figuras Anatomy que contradicen los diagramas (otro nombre o pieza) → mismos nombres que la tabla de piezas del doc 03.

---

### Task 1: Textos y diagramas Mermaid (rama `docs/arquitectura-c4`)
**Files:** Create `docs/arquitectura/README.md`, `01-negocio.md` … `08-flujos.md`; Create `docs/superpowers/plans/2026-10-27-documentacion-c4.md` (este plan).
- [ ] Leer el código real y anotar hechos con `archivo:línea`.
- [ ] Escribir 00–08 según el índice; cada uno abre con "Para principiantes".
- [ ] En README enlazar las figuras `figuras/heladeria-maquina.svg` y `figuras/viaje-compra.svg` (las crea Task 2; nombres fijos).
- [ ] Validar Mermaid; `git grep` de datos sensibles en `docs/`.
- [ ] Commit `docs: documentación C4 de la arquitectura`.

### Task 2: Figuras Anatomy (rama `docs/figuras-anatomy`)
**Files:** Create `docs/arquitectura/figuras/heladeria-maquina.{svg,html}`, `docs/arquitectura/figuras/viaje-compra.{svg,html}`, y su código fuente en `docs/arquitectura/figuras/src/`.
- [ ] Figura 1: heladería como máquina: cliente → mostrador (página web, Vercel) → cocina (servidor, Render) → bodega (base de datos, Supabase), con servicios externos como proveedores.
- [ ] Figura 2: viaje de una compra: carrito → pago → `registrar_venta` (venta + detalle + stock, todo o nada) → confirmación por correo.
- [ ] Exportar SVG estático (sin JS) para GitHub y HTML interactivo; pasar los checks de Anatomy.
- [ ] Commit `docs: figuras Anatomy de la arquitectura`.

### Task 3: Unir y revisar
- [ ] Merge `docs/figuras-anatomy` en `docs/arquitectura-c4`.
- [ ] code-reviewer contrasta cada dato con el código y revisa los 5 puntos de Review Focus; corregir lo que encuentre.
- [ ] Informe al usuario y pedir OK para el PR.
