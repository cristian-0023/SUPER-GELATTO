# 08 · Flujos: lo que pasa paso a paso

## Para principiantes

Aquí seguimos un pedido de principio a fin, como si fuéramos detrás de él por la heladería.
Por ejemplo, en una compra: el cliente llena su canasta en el mostrador, va a pagar, la cocina revisa el pedido, la caja registradora cobra con los precios de la libreta y saca los helados de la bodega, y al final un mensajero le lleva un correo de confirmación.
Cada dibujo de abajo es una "tira cómica" que se lee de arriba hacia abajo: cada flecha es un mensaje de una pieza a otra.
Los nombres de las piezas son los mismos de la [tabla de piezas](03-contenedores.md#tabla-de-piezas-nombres-oficiales).

![El viaje de una compra](figuras/viaje-compra.svg)

*Figura: el viaje de una compra. [Ver la versión animada](figuras/viaje-compra.html).*

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
  C->>W: Pagar en /checkout (PaymentGateway)
  W->>API: POST /api/payments/process con método, banco, items y userId
  API->>API: Límite 10 por minuto, valida método y carrito
  API->>API: Simula la pasarela, 1 a 2 s, aprox. 90 por ciento aprobado
  API->>RV: rpc registrar_venta(userId, items, Pagado o Fallido)
  alt Todo bien
    RV-->>API: id_venta, total con precios de la base, items
    opt Aprobado y con userId
      API->>M: Correo de pago confirmado
    end
    API-->>W: 200 ok, id_venta, total, transaction
    W->>W: Vacía el carrito si fue aprobado
  else Error de negocio, por ejemplo STOCK_INSUFICIENTE
    RV-->>API: Error P0001, no se guarda nada
    API-->>W: 409 o 400 con mensaje en español
  end
```

| Paso | Referencia |
|---|---|
| Llamada de la página (sin token) | `PaymentGateway.jsx:127-150` |
| Límite y validaciones | `server.js:2507-2546` |
| Resultado simulado y espera | `server.js:2554-2573` |
| `registrar_venta` | `server.js:2575-2587`; migración:121-287 |
| Correo de confirmación | `server.js:2613-2668` |
| Respuesta | `server.js:2678-2686` |
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
  API->>DB: Actualiza venta.estado
  alt La base falla
    API-->>W: 500, no se avisa al cliente
  else Guardado
    API->>DB: Lee correo y nombre del cliente
    API-)M: Correo según el estado, sin esperar
    API-->>W: 200 con emailNotified
  end
```

Referencias: `AdminDashboard.jsx:333`; `server.js:1948-2021`; plantilla de correo `server.js:679-781`.

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
