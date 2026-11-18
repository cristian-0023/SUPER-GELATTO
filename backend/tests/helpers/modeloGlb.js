// Datos de prueba para los modelos 3D que el servidor copia de Tripo al bucket "modelos-3d".
// Un GLB mínimo (empieza con "glTF") y la URL pública que el Storage falso le da a cada copia.
export const GLB_PRUEBA = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0]), Buffer.alloc(32, 7)]);

export const urlEnBucket = (idProducto, taskId) =>
  `http://supabase.fake.local/storage/v1/object/public/modelos-3d/producto-${idProducto}/${taskId}.glb`;

// Respuesta de la "CDN" de Tripo al descargar el modelo.
export const respuestaGlb = () => new Response(GLB_PRUEBA, { status: 200 });
