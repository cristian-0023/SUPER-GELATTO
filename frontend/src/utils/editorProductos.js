// Utilidades del editor de productos del panel de admin.

// Cuerpo que espera PUT /api/admin/products/:id (el modal usa "desc"; el servidor lee "descripcion").
export function armarCuerpoProducto(form) {
  return {
    name: form.name,
    precio: Number(form.precio),
    stock: Number(form.stock),
    categoria: form.categoria,
    descripcion: form.desc || ''
  };
}

// Devuelve la lista con el stock anterior de un producto (para deshacer la actualización optimista).
export function revertirStock(productos, productId, stockAnterior) {
  return productos.map(p => (p.id === productId ? { ...p, stock: stockAnterior } : p));
}
