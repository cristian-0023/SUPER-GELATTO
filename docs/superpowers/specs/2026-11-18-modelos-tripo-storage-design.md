# Modelos de Tripo guardados en Supabase Storage: diseño corto

## Intención
Los modelos 3D que Tripo genera desde el panel se guardan hoy con un enlace temporal que vence en unos minutos, así que el modelo deja de verse. Además llegan pesados, de 10 MB o más. Queremos que cada modelo generado quede guardado para siempre en un lugar nuestro y que pese poco.

## Objetivos
- Cuando Tripo termina, el servidor descarga el GLB y lo sube a un bucket propio de Supabase Storage. En `producto.model_3d_url` queda la URL permanente.
- Pedirle a Tripo modelos más livianos desde el origen, con un límite de caras o de calidad de textura.
- Si se regenera el modelo, borrar del bucket el archivo anterior para no acumular basura.

## No objetivos
- Comprimir en el servidor: se descartó la opción B por el límite de tiempo de Vercel.
- Recomprimir modelos viejos: hoy no hay ninguno guardado.
- Subir fotos de producto a Storage: es otra rama.

## Anti-objetivos (sería un fracaso aunque funcione)
- Que cualquiera pueda subir o borrar archivos del bucket. Solo debe poder hacerlo el servidor, con service_role.
- Que un modelo quede marcado como "listo" con un enlace que vence.
- Gastar dos tareas de Tripo o subir dos veces el mismo modelo.

## Approaches
- **A (elegida por el usuario):** copiar a Storage al terminar y pedir modelos livianos a Tripo. Es simple y no agrega herramientas pesadas.
- **B:** A más compresión en el servidor. Se descartó por el riesgo de corte por tiempo en Vercel.
- **C:** pedir un enlace nuevo a Tripo cada vez, sin copia. Se descartó porque depende de que Tripo guarde el modelo y los modelos siguen pesados.

## Cómo se construye
- **Migración (la aplica el usuario):** crear el bucket público de lectura `modelos-3d`, con límite de tamaño por archivo y solo `model/gltf-binary`. Políticas: lectura pública (SELECT) y ninguna escritura para anon o authenticated, porque service_role no necesita política. Debe poder aplicarse dos veces sin error y tener rollback.
- **Servidor:** en `GET /api/admin/products/:id/model-3d`, cuando Tripo responde `success`:
  1. Validar la URL de Tripo, como ya se hace.
  2. Descargar con tiempo máximo y tamaño máximo, y comprobar que el archivo sea un GLB mirando los primeros bytes `glTF`.
  3. Subir a `modelos-3d/producto-<id>/<taskId>.glb`.
  4. Guardar la URL pública con el mismo filtro `.eq('model_3d_task_id', tarea)`, para no pisar una tarea nueva.
  5. Recién entonces marcar `listo`.
- **Si la copia falla:** mientras el enlace de Tripo siga vivo, queda en `generando` y se reintenta en la próxima consulta. Si Tripo ya no entrega el archivo, pasa a `error` con un mensaje claro en español.
- **Tripo:** agregar al pedido los parámetros que reduzcan el peso, como `face_limit` y la calidad de textura, **solo si la documentación oficial de Tripo los confirma**.
- **Vercel:** subir el `maxDuration` de la función si la descarga lo necesita, dentro del límite del plan.

## Queda a criterio del constructor
- Los valores exactos de tamaño máximo, tiempo máximo y límite de caras, siempre que sean razonables y queden documentados.
- La forma de probar la descarga, con un fetch y un Storage falsos.
