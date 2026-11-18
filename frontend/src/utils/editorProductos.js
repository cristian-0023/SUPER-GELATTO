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

// Imágenes predeterminadas que ofrecen el modal de imagen y el alta de productos.
export const IMAGENES_PREDETERMINADAS = [
  { label: 'Fresa', url: '/images/gelato_fresa.png' },
  { label: 'Chocolate', url: '/images/gelato_chocolate.png' },
  { label: 'Mango', url: '/images/gelato_mango.png' },
  { label: 'Berries', url: '/images/gelato_berries.png' },
  { label: 'Pistacho', url: '/images/gelato_pistacho.png' },
  { label: 'Caramelo', url: '/images/caramelo salado.png' },
  { label: 'Vainilla', url: '/images/vainilla de madagascar.png' },
  { label: 'Limón', url: '/images/limone di amalfi.png' },
  { label: 'Tiramisú', url: '/images/Tiramisú Artigianale.png' },
  { label: 'Coco', url: '/images/Coco & Lima.png' },
];

// Cuerpo de POST /api/admin/products a partir del formulario "Agregar producto".
// Un precio vacío se manda vacío (no 0) para que el servidor lo rechace; el stock vacío no se manda
// (el servidor pone 50) y la imagen vacía tampoco (el servidor elige una por el nombre).
export function armarCuerpoAlta(form) {
  const vacio = (v) => v === '' || v === null || v === undefined;
  const cuerpo = {
    name: form.name,
    precio: vacio(form.price) ? '' : Number(form.price),
    categoria: form.category,
    descripcion: form.description || '',
    featured: form.featured === true,
  };
  if (!vacio(form.stock)) cuerpo.stock = Number(form.stock);
  const imagen = typeof form.image === 'string' ? form.image.trim() : '';
  if (imagen) cuerpo.image = imagen;
  return cuerpo;
}

// Producto de la lista del panel a partir de la fila que devolvió el servidor al crearlo.
export function productoCreadoParaPanel(fila) {
  return { id: fila.id_producto, ...mapearProductoGuardado(fila), destacado: fila.destacado };
}
