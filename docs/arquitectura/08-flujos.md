# 08 · Flujos: lo que pasa paso a paso

## Para principiantes

Aquí seguimos un pedido de principio a fin, como si fuéramos detrás de él por la heladería.
Por ejemplo, en una compra: el cliente llena su canasta en el mostrador, va a pagar, la cocina revisa el pedido, la caja registradora cobra con los precios de la libreta y saca los helados de la bodega, y al final un mensajero le lleva un correo de confirmación.
Cada dibujo de abajo es una "tira cómica" que se lee de arriba hacia abajo: cada flecha es un mensaje de una pieza a otra.
Los nombres de las piezas son los mismos de la [tabla de piezas](03-contenedores.md#tabla-de-piezas-nombres-oficiales).

![El viaje de una compra](figuras/viaje-compra.svg)

*Figura: el viaje de una compra. [Descarga el archivo y ábrelo en el navegador para verla animada](figuras/viaje-compra.html).*

## Detalle técnico

Los flujos citan **rutas y funciones** (los números de línea cambian con cada PR). Verificado contra `main` el 2026-11-26.

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

| Paso | Dónde |
|---|---|
| Llamada de la página | `PaymentGateway.jsx` (manda el token con `apiFetch`) |
| Límite y validaciones (incluye `puntosUsar` y las líneas personalizadas) | ruta `POST /api/payments/process`, `validarCarrito`, `validarPuntosUsar` |
| Resultado simulado y espera | misma ruta (90 % aprobado, 1 a 2 s) |
| `registrar_venta` con `p_puntos_usar` | migración `20261120130000_helado_personalizado.sql` (versión vigente) |
| Correo de confirmación (muestra el descuento y la composición del helado personalizado) | misma ruta |
| Vaciar carrito | `CheckoutPage.jsx` |

### 2. Registrarse e iniciar sesión

**a) Registro con correo y contraseña (queda con la sesión iniciada)**

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Tienda web
  participant API as API Express
  participant DB as Base de datos
  C->>W: Datos en /register
  W->>API: POST /api/register
  API->>API: Límite 10 cada 15 min, valida nombre, correo y contraseña, rechaza correos reservados
  API->>DB: Busca el correo y, si no existe, inserta el cliente (contraseña con bcrypt)
  DB-->>API: Fila creada (sin password_hash)
  API-->>W: 201 con token y user, el mismo formato que el login
  W->>W: Guarda la sesión y entra directo a la tienda
```

Si dos registros llegan a la vez con el mismo correo, el segundo recibe 409 (candado único de la base). Si la base no devolvió la fila, se registra sin sesión y la página manda a `/login`.

**b) Con correo y contraseña**

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

**c) Con Google**

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

**d) Facial (solo administradores)**

Se explica completo en [reconocimiento-facial.md](../reconocimiento-facial.md). En resumen: la foto viaja a `POST /api/admin/faceid/rekognition-login`, AWS Rekognition busca el rostro (similitud mínima 70), la base dice a qué usuario pertenece y se exige `rol = 'admin'`; la respuesta es el mismo `token` y `user` del login.

Todos los caminos guardan la sesión igual (`frontend/src/utils/sesion.js`) y esta dura lo que dura el token (24 h).

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
  API->>DB: Busca el usuario y cuenta sus enlaces recientes (espera de 2 min, tope de 5 al día)
  API->>DB: Anula los enlaces anteriores y guarda el sha256 del nuevo en reset_tokens
  API->>M: Correo con el enlace FRONTEND_URL/reset-password/código, válido 30 min
  API-->>W: Mensaje genérico, no revela si el correo existe
  C->>W: Abre el enlace
  W->>API: GET /api/reset-password/código
  API-->>W: valid true o ENLACE_INVALIDO
  C->>W: Escribe la nueva contraseña
  W->>API: POST /api/reset-password/código
  API->>DB: Marca el enlace como usado (una sola vez) y guarda el nuevo password_hash
  API-->>W: Contraseña actualizada, el enlace ya no sirve
```

Antes estaba rota (la página validaba con un `GET` que el servidor no tenía); se arregló en el PR #5 y hoy tiene su prueba (`backend/tests/api/recuperarContrasena.test.js`). Sin SMTP real o sin `FRONTEND_URL` en producción, la ruta responde 503 en lugar de mandar enlaces a localhost.

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

Los puntos del cambio de estado (cobrar o cancelar) se describen en la sección 8.

### 5. Gelbot: chat con textos del servidor

Detalle completo en [chatbot_documentation.md](../chatbot_documentation.md). Para un **cliente o visitante**:

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Tienda web (Gelbot)
  participant API as API Express
  participant GB as gelbotCliente
  participant Q as Groq
  participant DB as Base de datos
  C->>W: Escribe un mensaje
  W->>API: POST /api/chatbot con message y, si hay, el Bearer
  API->>GB: Sesión sacada del token (sin token = visitante)
  GB->>GB: Atajos sin modelo (ficha, precio, pedido claro, menú, gracias...)
  opt Ningún atajo alcanza
    GB->>Q: UNA llamada: el modelo solo puede elegir un tema o una herramienta
    Q-->>GB: tema (su texto se descarta)
  end
  GB->>DB: Catálogo (caché 1 min), pedidos del token o reglas de puntos si el tema lo pide
  GB->>GB: Arma la respuesta con plantillas del servidor y la ficha del sabor
  GB-->>W: texto, acción (addToCart o closeChat), producto y tarjetas con foto
```

Para un **administrador** el flujo es el de dos llamadas, con confirmación para las acciones que cambian datos:

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant GB as Gelbot (chatbot.js)
  participant Q as Groq
  participant DB as Base de datos
  A->>W: Escribe borra el producto 7
  W->>API: POST /api/chatbot con message y Bearer
  API->>GB: Sesión sacada del token
  GB->>Q: Mensaje y herramientas de administrador
  Q-->>GB: Pide la herramienta deleteProduct
  GB->>GB: No ejecuta, crea un código de un solo uso de 5 min ligado a este admin
  GB-->>W: Pide confirmación con el resumen y el código
  A->>W: Pulsa Confirmar
  W->>API: POST /api/chatbot con confirmar igual al código
  GB->>GB: Valida que el código sea del mismo admin y no haya vencido
  GB->>DB: Borra el producto
  GB-->>W: Acción hecha
```

Un visitante o cliente nunca recibe las herramientas de administrador.

### 6. Producto con modelo 3D

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web
  participant API as API Express
  participant T as Tripo 3D
  participant S as Storage (modelos-3d)
  participant DB as Base de datos
  A->>W: Crea un producto con un prompt 3D
  W->>API: POST /api/admin/products
  API->>DB: Inserta el producto con las reglas compartidas
  API->>DB: Reserva model_3d_estado = generando (update condicional)
  API->>T: Crea la tarea text_to_model
  T-->>API: task_id
  API->>DB: Guarda model_3d_task_id
  loop Cada 3 s mientras genera
    W->>API: GET /api/admin/products/id/model-3d
    API->>T: Consulta el estado de la tarea
    T-->>API: progreso o URL temporal del modelo
  end
  API->>T: Descarga el GLB (60 s y 50 MB como máximo, solo https público)
  API->>S: Sube producto-id/taskId.glb
  API->>DB: model_3d_url = URL permanente, model_3d_estado = listo
  API->>S: Borra el modelo anterior del producto
  API-->>W: estado listo y URL
  W->>W: Model3DPreview muestra el modelo
```

Detalle y límites en [modelos-3d.md](../modelos-3d.md).

### 7. Helado personalizado 3D

```mermaid
sequenceDiagram
  actor C as Cliente
  participant W as Tienda web (GelatoBuilder3D)
  participant API as API Express
  participant RV as registrar_venta
  C->>W: Arma envase, sabores (1 a 3) y toppings (0 a 3)
  W->>API: GET /api/personalizado/precios
  API-->>W: precios y límites de la base
  C->>W: Agrega al carrito y paga
  W->>API: POST /api/payments/process con la línea personalizada
  API->>API: Valida solo la forma de la línea
  API->>RV: rpc registrar_venta
  Note over RV: Valida ids y máximos, pone el precio, guarda la composición en detalle_venta.personalizacion y no descuenta stock
  RV-->>API: venta con la composición
  API-->>W: recibo con la composición
```

### 8. Cancelar una venta y devolver Super Points

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

- Si el cliente ya gastó los puntos ganados, se quita solo lo que tenga. El movimiento `revertido` anota lo que realmente se quitó, y el nivel se recalcula con el saldo que queda (regla del 2026-11-19: el nivel sale del saldo actual).
- Si un admin saca la venta de "Cancelado", los puntos no se vuelven a mover.
- Una venta sin movimientos (Fallido, Pendiente o anterior al programa) no mueve nada al cancelarse.

La función `cambiar_estado_venta` está en `supabase/migrations/20261111120000_super_points.sql`.

### 9. Ocultar o mostrar un producto

```mermaid
sequenceDiagram
  actor A as Administrador
  participant W as Tienda web (panel)
  participant API as API Express
  participant DB as Base de datos
  A->>W: Intenta borrar un producto que tiene ventas
  W->>API: DELETE /api/admin/products/id
  API-->>W: 409, no se puede borrar
  W->>W: Aviso con el botón Ocultar
  A->>W: Pulsa Ocultar
  W->>API: PUT /api/admin/products/id/visible con estado false
  API->>DB: update producto set estado = false
  API-->>W: ok; el panel lo marca como Oculto (con Deshacer)
  Note over API,DB: La tienda y Gelbot solo leen estado = true; la caché del chat se invalida y la del CDN tarda hasta unos 60 s
```

El panel pide la lista con `GET /api/admin/products`, que incluye también los ocultos.
