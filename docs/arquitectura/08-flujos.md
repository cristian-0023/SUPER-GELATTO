# 08 · Flujos: lo que pasa paso a paso

## Para principiantes

Aquí seguimos un pedido de principio a fin, como si fuéramos detrás de él por la heladería.
Por ejemplo, en una compra: el cliente llena su canasta en el mostrador, va a pagar, la cocina revisa el pedido, la caja registradora cobra con los precios de la libreta y saca los helados de la bodega, y al final un mensajero le lleva un correo de confirmación.
Cada dibujo de abajo es una "tira cómica" que se lee de arriba hacia abajo: cada flecha es un mensaje de una pieza a otra.
Los nombres de las piezas son los mismos de la [tabla de piezas](03-contenedores.md#tabla-de-piezas-nombres-oficiales).

![El viaje de una compra](figuras/viaje-compra.svg)

*Figura: el viaje de una compra. [Descarga el archivo y ábrelo en el navegador para verla animada](figuras/viaje-compra.html).*

## Detalle técnico

### 1. Compra

```mermaid
sequenceDiagram
  autonumber
  actor C as Cliente
  participant W as Tienda web
  participant API as API Express
  participant RV as registrar_venta
  participant M as Servidor de correo SMTP
  C->>W: Pagar en /checkout (PaymentGateway), elige cuántos Super Points usar
  W->>API: POST /api/payments/process con token, método, banco, items y puntosUsar
  API->>API: Verifica la sesión, límite 10 por minuto, valida método, carrito y puntosUsar
  API->>API: Simula la pasarela, 1 a 2 s, aprox. 90 por ciento aprobado
  API->>RV: rpc registrar_venta(usuario del token, items, Pagado o Fallido, p_puntos_usar)
  Note over RV: Bloquea al cliente, revisa saldo y tope de su nivel, resta el descuento, anota canjeado y ganado si es Pagado
  alt Todo bien
    RV-->>API: id_venta, total con descuento, puntos usados y ganados, saldo, items
    opt Aprobado
      API->>M: Correo de pago confirmado
    end
    API-->>W: 200 ok, id_venta, total, subtotal, puntos, transaction
    W->>W: Vacía el carrito si fue aprobado
  else Error de negocio, por ejemplo STOCK_INSUFICIENTE
    RV-->>API: Error P0001, no se guarda nada
    API-->>W: 409 o 400 con mensaje en español
  end
```

| Paso | Referencia |
|---|---|
| Llamada de la página (sin token) | `PaymentGateway.jsx:127-150` |
| Límite y validaciones (incluye `puntosUsar`) | `server.js:2771-2807`; `validarPuntosUsar` en `server.js:2719-2723` |
| Resultado simulado y espera | `server.js:2818-2834` |
| `registrar_venta` con `p_puntos_usar` | `server.js:2839-2850`; migración `20261111120000_super_points.sql:202-430` |
| Canje: saldo, tope y descuento | migración `20261111120000_super_points.sql:343-366` |
| Correo de confirmación (muestra el descuento) | `server.js:2885-2941` |
| Respuesta (total, descuento, puntos usados y ganados) | `server.js:2953-2960` |
| Vaciar carrito | `CheckoutPage.jsx:62-66` |

### 2. Iniciar sesión

**a) Con correo y contraseña**

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Tienda web
  participant API as API Express
  participant DB as Base de datos
  C->>W: Correo y contraseña en /login
  W->>API: POST /api/login
  API->>API: Límite 10 cada 15 min, valida el correo
  API->>DB: Busca usuario por correo
  DB-->>API: Usuario con password_hash y rol
  API->>API: bcrypt.compare
  API-->>W: token firmado HS256, 24 h, con el rol de la base
  W->>W: Guarda el token, apiFetch lo manda como Bearer
```

Referencias: `Login.jsx:115`; `server.js:1140-1188`; firma en `server.js:816-822`; guardado en `api.js:21-26`.

**b) Con Google**

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Tienda web
  participant G as Google Sign-In
  participant API as API Express
  participant DB as Base de datos
  C->>W: Botón de Google
  W->>G: Inicia sesión
  G-->>W: credential, un ID token firmado por Google
  W->>API: POST /api/google-login con credential
  API->>G: verifyIdToken, audiencia GOOGLE_CLIENT_ID
  G-->>API: correo verificado y nombre
  API->>DB: Busca por correo y si no existe crea un cliente
  API->>API: Si el correo está en ADMIN_EMAILS, el token sale con rol admin
  API-->>W: token
```

Referencias: `Login.jsx:75`, `Login.jsx:312`; `server.js:1365-1463`; elevación en `server.js:810-813` y `server.js:1418-1426`.

**c) Facial (solo administradores)**

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant R as AWS Rekognition
  participant DB as Base de datos
  Note over A,DB: Antes, ya con sesión, el admin registró su rostro con POST /api/admin/faceid/rekognition-register
  A->>W: Foto con CapturaFacial en /login
  W->>API: POST /api/admin/faceid/rekognition-login con la imagen
  API->>R: SearchFacesByImage, similitud mínima 70
  R-->>API: FaceId encontrado
  API->>DB: admin_face_rekognition, luego usuario
  API->>API: Exige rol admin en la base
  API-->>W: token o 401 genérico
```

Referencias: registro `server.js:1193-1254`; login `server.js:1257-1355`; `Login.jsx:143`.

### 3. Recuperar la contraseña

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Tienda web
  participant API as API Express
  participant DB as Base de datos
  participant M as Servidor de correo SMTP
  C->>W: Correo en /forgot-password
  W->>API: POST /api/forgot-password
  API->>DB: Busca el usuario
  API->>API: Crea un código aleatorio válido 1 hora, guardado en memoria
  API->>M: Correo con el enlace FRONTEND_URL/reset-password/código
  API-->>W: Mensaje genérico, no revela si el correo existe
  C->>W: Abre el enlace
  W->>API: GET /api/reset-password/código para validar el enlace
  API-->>W: 404, esa ruta no existe
  Note over C,W: Hoy el flujo se corta aquí: la página muestra un error y no enseña el formulario
  C->>W: Escribe la nueva contraseña, solo si el formulario apareciera
  W->>API: POST /api/reset-password/código
  API->>DB: Guarda el nuevo password_hash
  API-->>W: Contraseña actualizada, el código ya no sirve
```

Referencias: `server.js:1466-1518`, `server.js:1521-1562`; códigos en memoria `server.js:624`; páginas `ForgotPassword.jsx:49`, `ResetPassword.jsx:20` (validación con `GET`, que el servidor no tiene), `ResetPassword.jsx:195` (pantalla de error), `ResetPassword.jsx:138` (envío con `POST`).

> **Error conocido:** la recuperación de contraseña está rota de punta a punta. El servidor solo acepta `POST /api/reset-password/:token`; la página primero pide un `GET` a esa dirección, recibe 404 y se queda en la pantalla de error. Ver [05-componentes-frontend.md](05-componentes-frontend.md#desajustes-entre-la-página-y-el-servidor).

### 4. Cambio de estado de una venta y correo

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant DB as Base de datos
  participant M as Servidor de correo SMTP
  A->>W: Elige un estado nuevo en /admin
  W->>API: PUT /api/admin/sales/id/status con Bearer
  API->>API: requireAdmin y el estado debe ser uno de los 9
  API->>DB: rpc cambiar_estado_venta: cambia el estado y mueve los Super Points en una transacción
  alt La base falla
    API-->>W: 500, no se avisa al cliente
  else Guardado
    API->>DB: Lee correo y nombre del cliente
    API-)M: Correo según el estado, sin esperar
    API-->>W: 200 con emailNotified
  end
```

Referencias: `AdminDashboard.jsx:333`; `server.js:2149-2229` (ruta; la llamada a la base en `server.js:2163`); plantilla de correo `server.js:679-781`. Los puntos del cambio de estado (cobrar o cancelar) se describen en la sección 7.

### 5. Gelbot con confirmación

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant GB as Gelbot
  participant Q as Groq
  participant DB as Base de datos
  A->>W: Escribe borra el producto 7
  W->>API: POST /api/chatbot con message y Bearer
  API->>GB: Sesión sacada del token
  GB->>Q: Mensaje y herramientas permitidas para su rol
  Q-->>GB: Pide la herramienta deleteProduct
  GB->>GB: No ejecuta, crea un código de un solo uso de 5 min
  GB-->>W: Pide confirmación con el código
  A->>W: Pulsa Confirmar
  W->>API: POST /api/chatbot con confirmar igual al código
  GB->>GB: Valida que el código sea del mismo admin y no haya vencido
  GB->>DB: Borra el producto
  GB-->>W: Acción hecha
```

Referencias: `Gelbot.jsx:142-144`, `Gelbot.jsx:220-221`; `server.js:2703-2707`; `chatbot.js:333-382`, `chatbot.js:519-538`, `chatbot.js:544-549`, `chatbot.js:716-731`. Un visitante o cliente nunca recibe las herramientas de admin (`chatbot.js:599-600`).

### 6. Producto con modelo 3D

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant T as Tripo 3D
  participant JS as Archivos JSON locales
  participant DB as Base de datos
  A->>W: Crea un producto con un prompt 3D
  W->>API: POST /api/admin/products
  API->>DB: Inserta el producto, la base da el id
  API->>T: Crea la tarea text_to_model
  T-->>API: task_id
  API->>JS: Guarda la tarea como generando
  loop Cada pocos segundos, máximo 50 veces
    W->>API: GET /api/admin/products/id/model-3d
    API->>T: Consulta el estado de la tarea
    T-->>API: progreso o URL del modelo
  end
  API->>DB: Guarda producto.model_3d_url
  API->>JS: Marca la tarea como lista
  API-->>W: estado listo y URL
  W->>W: Model3DPreview muestra el modelo
```

Referencias: `server.js:2077-2179` (crear e iniciar Tripo), `server.js:126-182` (llamadas a Tripo), `server.js:2712-2775` (consulta y guardado), `server.js:2778-2809` (regenerar); sondeo en la página `AdminDashboard.jsx:740-760`.

### 7. Cancelar una venta y devolver Super Points

Cuando un admin pasa una venta cobrada a "Cancelado", la base hace todo en una sola transacción: devuelve lo canjeado y quita lo ganado.

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant DB as Base de datos
  A->>W: Pasa la venta a Cancelado
  W->>API: PUT /api/admin/sales/id/status con Bearer
  API->>DB: rpc cambiar_estado_venta(id, Cancelado)
  alt Error de la base
    DB-->>API: Error, no se cambia nada
    API-->>W: Error, no se avisa al cliente
  else Transacción correcta
    Note over DB: Pasa una sola vez por venta
    DB->>DB: Anota devuelto con los puntos canjeados
    DB->>DB: Anota revertido y quita los ganados sin bajar el saldo de cero
    DB-->>API: estado anterior, puntos usados y descuento
    API-->>W: 200 y correo al cliente
  end
```

- Si el cliente ya gastó los puntos ganados, se quita solo lo que tenga. El movimiento `revertido` anota lo que realmente se quitó, y el nivel deja de contar todos los puntos ganados en esa venta.
- Si un admin saca la venta de "Cancelado", los puntos no se vuelven a mover.
- Una venta sin movimientos (Fallido, Pendiente o anterior al programa) no mueve nada al cancelarse.

Referencias: `server.js:2149-2229` (ruta; la llamada en `server.js:2163`); función `cambiar_estado_venta` en `supabase/migrations/20261111120000_super_points.sql:446-533` (reversa en las líneas 497-520).
