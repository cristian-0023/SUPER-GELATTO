# Modelos de Tripo en Supabase Storage: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada modelo que genera Tripo queda copiado en el bucket propio `modelos-3d`, con una URL permanente y más liviano desde el origen.

**Architecture:** Un módulo `backend/modelos3dStorage.js` descarga el GLB de Tripo, lo valida y lo sube a Storage. La ruta `GET /api/admin/products/:id/model-3d` lo llama cuando Tripo responde `success`, y solo entonces marca `listo`. El bucket lo crea una migración que aplica el usuario.

**Tech Stack:** Express 4, supabase-js v2 (Storage), fetch de Node, vitest + supertest + Supabase falso, PGlite.

**Spec:** `docs/superpowers/specs/2026-11-18-modelos-tripo-storage-design.md` (se copia del scratchpad del orquestador en el Task 1).

## Global Constraints
- Rama `feat/modelos-tripo-storage` creada desde `origin/main` (que incluye el PR #11). Sin push ni merge.
- Commits en español, sin Co-Authored-By.
- Usar solo los paquetes que ya tiene el backend. Prohibido gltf-transform en el servidor.
- Bucket `modelos-3d`: público de lectura, `file_size_limit` 52428800 (50 MB), `allowed_mime_types` `{model/gltf-binary}`. anon y authenticated sin INSERT, UPDATE ni DELETE.
- Ruta del archivo: `producto-<id>/<taskId>.glb`.
- Descarga con un máximo de 60 s y de 50 MB. Los primeros 4 bytes deben ser `glTF`.
- Errores al cliente en español y sin detalles internos. El detalle va al log.
- No se lanzan otros agentes; el máximo es de 4 a la vez.
- Backend: `cd backend && npm test` empieza con 888 pruebas en verde y debe terminar con más.

## Review Focus
- Tripo entrega HTML o un JSON de error en vez de un GLB: no se sube nada, el estado queda `generando` y se reintenta (Task 2).
- Archivo de más de 50 MB o descarga que se cuelga: se corta sin agotar la función y no se sube nada (Task 2).
- Dos consultas simultáneas del mismo modelo terminado: se sube con `upsert:true` a la misma ruta y se guarda una sola vez con `.eq('model_3d_task_id', tarea)` (Task 3).
- Regenerar mientras se copia el modelo anterior: el modelo viejo no pisa la tarea nueva (Task 3).
- El enlace de Tripo ya venció (403/404): el estado pasa a `error` con el mensaje "El modelo ya no está disponible en Tripo; regenerá el modelo." (Task 3).

---

### Task 1: Bucket `modelos-3d` (migración)

**Files:**
- Create: `supabase/migrations/20261118120000_bucket_modelos_3d.sql`
- Create: `supabase/rollbacks/20261118120000_bucket_modelos_3d.rollback.sql`
- Create: `docs/superpowers/specs/2026-11-18-modelos-tripo-storage-design.md`, copiada del scratchpad del orquestador.
- Test: `backend/tests/db/bucketModelos3d.test.js`

**Interfaces:**
- Produces: el bucket `modelos-3d` y la política `modelos_3d_lectura_publica` (SELECT para public, `bucket_id = 'modelos-3d'`).

- [ ] **Step 1:** Escribir las pruebas con PGlite. Copiar el patrón de cómo `tests/db` simula el esquema `storage` en la migración `20261110120000_storage_helados_solo_lectura`.
  - `crea el bucket público con límite 52428800 y mime model/gltf-binary`
  - `solo existe una política SELECT sobre modelos-3d`
  - `aplicar dos veces no falla`
  - `el rollback borra la política y el bucket`
- [ ] **Step 2:** Correr `cd backend && npx vitest run tests/db/bucketModelos3d.test.js`. Esperado: FAIL, porque no existe la migración.
- [ ] **Step 3:** Escribir la migración con `insert ... on conflict (id) do update` y `drop policy if exists`, más el rollback.
  - Seguir la convención de las otras migraciones: `begin`/`commit` y `lock_timeout`.
  - El rollback solo borra el bucket si está vacío, y lo explica en un comentario.
- [ ] **Step 4:** Correr `npm test`. Esperado: todo en verde.
- [ ] **Step 5:** Commit `feat: bucket modelos-3d de solo lectura pública`.

### Task 2: Módulo de copia `backend/modelos3dStorage.js`

**Files:**
- Create: `backend/modelos3dStorage.js`
- Test: `backend/tests/api/modelos3dStorage.test.js`

**Interfaces:**
- Produces: `async function copiarModeloATienda({ supabase, idProducto, taskId, urlTripo, fetchFn = fetch, timeoutMs = 60000, maxBytes = 52428800 })`, que devuelve uno de estos objetos:
  - `{ ok: true, url, ruta }`
  - `{ ok: false, motivo: 'reintentar' }`: falla de red, timeout, contenido no GLB o error de Storage.
  - `{ ok: false, motivo: 'vencido' }`: Tripo responde 403, 404 o 410.
  - `{ ok: false, motivo: 'muy_grande' }`
- Produces: `async function borrarModeloAnterior({ supabase, url })`, que borra el archivo solo si la URL pertenece al bucket `modelos-3d`. Nunca lanza error; si algo falla, lo registra en el log.

- [ ] **Step 1:** Escribir las pruebas con `fetchFn` falso y Storage falso. Si hace falta, extender `tests/helpers/fakeSupabase.js` con `storage.from(b).upload/getPublicUrl/remove`, registrando las llamadas.
  - `GLB válido se sube a producto-<id>/<taskId>.glb con contentType model/gltf-binary y upsert true y devuelve la URL pública`
  - `HTML o JSON no se sube → reintentar`
  - `Content-Length > maxBytes → muy_grande sin leer el cuerpo`
  - `cuerpo que supera maxBytes al leer → muy_grande`
  - `timeout → reintentar`
  - `403/404/410 → vencido`
  - `error de upload → reintentar y log sin datos internos al cliente`
  - `borrarModeloAnterior ignora URLs de otros dominios o buckets`
- [ ] **Step 2:** Correr las pruebas y verlas en rojo.
- [ ] **Step 3:** Implementar.
  - Usar `AbortController` para el timeout.
  - Leer el cuerpo por partes y cortar al pasar `maxBytes`.
  - Validar los primeros 4 bytes contra `glTF`.
  - Subir con `supabase.storage.from('modelos-3d').upload(ruta, buffer, { contentType: 'model/gltf-binary', upsert: true })`.
- [ ] **Step 4:** Correr `npm test`. Esperado: todo en verde.
- [ ] **Step 5:** Commit `feat: copiar modelos de Tripo al bucket propio`.

### Task 3: Conectar la copia a la ruta, aligerar el pedido a Tripo y ajustar la configuración de Vercel

**Files:**
- Modify: `backend/server.js`
  - `GET /api/admin/products/:id/model-3d`, en la rama success, alrededor de las líneas 3165-3210.
  - `startTripoTask`, alrededor de las líneas 70-95.
  - `iniciarTareaModelo3D`, al regenerar.
- Modify: `backend/vercel.json`, solo si hace falta `functions.maxDuration`.
- Modify: `docs/arquitectura/` (03 y 07), con el bucket nuevo.
- Test: `backend/tests/api/modelosTripoStorage.test.js`

**Interfaces:**
- Consumes: `copiarModeloATienda` y `borrarModeloAnterior` del Task 2.

- [ ] **Step 1:** Escribir las pruebas.
  - `success + copia ok → update {model_3d_url: url del bucket, model_3d_estado:'listo'} con .eq('model_3d_task_id', tarea) y nunca guarda la URL de Tripo`
  - `copia reintentar → sigue 'generando', 200 con mensaje "Guardando el modelo…"`
  - `copia vencido → 'error' y mensaje "El modelo ya no está disponible en Tripo; regenerá el modelo."`
  - `copia muy_grande → 'error' y mensaje "El modelo es demasiado grande para guardarlo."`
  - `regenerar con un model_3d_url del bucket llama a borrarModeloAnterior después de reservar`
  - `startTripoTask manda los parámetros de liviandad confirmados`. Escribir este test solo si se confirmaron los parámetros (ver Step 3).
- [ ] **Step 2:** Correr las pruebas y verlas en rojo.
- [ ] **Step 3:** Implementar.
  - Antes de tocar `startTripoTask`, leer la documentación oficial de Tripo (`https://platform.tripo3d.ai/docs`, el endpoint `text_to_model`) con WebFetch o con el agente web-fetch.
    - Si confirma parámetros como `face_limit` o `texture_quality`, usar `face_limit: 100000` y la calidad de textura estándar.
    - Si no los confirma, no agregar nada y anotarlo en el informe.
  - Si hace falta, poner `maxDuration` de 60 para `server.js` en `vercel.json`.
- [ ] **Step 4:** Correr `npm test` y `node -e "require('./server.js')"`. Esperado: todo en verde y el servidor carga.
- [ ] **Step 5:** Commit `feat: modelos de Tripo guardados con enlace permanente`.
