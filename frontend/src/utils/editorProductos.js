// Utilidades del editor de productos del panel de admin.

// Cuerpo de PUT /api/admin/products/:id con SOLO los campos que cambiaron respecto de los valores
// con que se abrió el modal (el servidor lee "descripcion"; el modal usa "desc").
// Un precio o stock vacío se manda vacío (no 0) para que el servidor lo rechace.
export function armarCuerpoProducto(form, original) {
  const cuerpo = {};
  const numero = (v) => (v === '' || v === null || v === undefined ? '' : Number(v));
  if (form.name !== original.name) cuerpo.name = form.name;
  if (numero(form.precio) !== numero(original.precio)) cuerpo.precio = numero(form.precio);
  if (numero(form.stock) !== numero(original.stock)) cuerpo.stock = numero(form.stock);
  if (form.categoria !== original.categoria) cuerpo.categoria = form.categoria;
  if ((form.desc || '') !== (original.desc || '')) cuerpo.descripcion = form.desc || '';
  return cuerpo;
}

// Producto de la lista del panel a partir de la fila que devolvió el servidor al guardar.
export function mapearProductoGuardado(fila) {
  return {
    name: fila.nombre,
    precio: fila.precio,
    price: fila.precio,
    stock: fila.stock,
    desc: fila.descripcion,
    categoria: fila.categoria,
    image: fila.imagen
  };
}
