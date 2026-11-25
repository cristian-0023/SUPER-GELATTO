// Los 13 productos activos de la base real (copiados el 2026-11-25; solo las columnas que usan las pruebas).
const p = (id_producto, nombre, precio, categoria, tags) =>
  ({ id_producto, nombre, precio, categoria, tags, imagen: `/images/${id_producto}.png`, descripcion: `Descripción de ${nombre}`, estado: true, stock: 50 });

export const CATALOGO_REAL = [
  p(1, 'Fresa Salvaje', 9000, 'Gourmet', 'Sin gluten, Frutal, Temporada'),
  p(2, 'Cioccolato Nero', 10000, 'Clásico', 'Sin gluten, Intenso, Gourmet'),
  p(3, 'Mango Tropical', 9500, 'Vegano', 'Vegano, Sin lácteos, Sin gluten, Frutal'),
  p(4, 'Frutos del Bosque', 11000, 'Temporada', 'Antioxidante, Sin gluten, Frutal'),
  p(5, 'Pistacchio di Bronte', 13000, 'Clásico', 'DOP Certificado, Gourmet, Importado'),
  p(6, 'Caramelo Salado', 8500, 'Clásico', 'Sin gluten, Artesanal, Bestseller'),
  p(7, 'Vainilla de Madagascar', 9000, 'Clásico', 'Sin gluten, Clásico, Gourmet'),
  p(8, 'Limone di Amalfi', 9500, 'Vegano', 'Vegano, Sin lácteos, Sin gluten, Refrescante'),
  p(9, 'Tiramisú Artigianale', 12000, 'Clásico', 'Gourmet, Artesanal, Especial'),
  p(10, 'Coco & Lima', 10000, 'Vegano', 'Vegano, Sin lácteos, Sin gluten, Tropical'),
  p(11, 'Rosa & Lichi', 14000, 'Temporada', 'Premium, Edición Limitada, Floral'),
  p(12, 'Matcha Ceremonial', 11500, 'Vegano', 'Vegano, Sin lácteos, Antioxidante, Ceremonial'),
  p(13, 'Helado de Pistacho Italiano', 14500, 'Clásico', null),
];

// Ingredientes y alérgenos que muestra la ficha de la tienda (escritos a mano, no leídos del módulo).
export const FICHAS = {
  1: ['Fresas silvestres, Azúcar de caña, Leche entera, Crema de leche, Vinagre balsámico, Zumo de limón', 'Lácteos'],
  2: ['Cacao 72% Tumaco, Azúcar moscabado, Leche entera, Crema de leche, Yemas de huevo, Extracto de vainilla', 'Lácteos, Huevo, Cacao'],
  3: ['Mango Tommy Atkins, Mango Ataúlfo, Azúcar de palma, Zumo de maracuyá, Zumo de limón', null],
  4: ['Moras de Boyacá, Arándanos silvestres, Frambuesas, Leche entera, Crema de leche, Azúcar de caña', 'Lácteos'],
  5: ['Pistacho DOP Bronte 40%, Leche entera, Crema de leche, Azúcar de caña, Yemas de huevo', 'Pistacho, Lácteos, Huevo'],
  6: ['Azúcar caramelizado, Flor de sal La Guajira, Leche entera, Crema extra grasa, Mantequilla artesanal, Extracto de vainilla', 'Lácteos'],
  7: ['Vainilla Bourbon Madagascar, Leche entera, Crema de leche, Yemas de huevo, Azúcar de caña', 'Lácteos, Huevo'],
  8: ['Limón Sfusato Amalfitano IGP, Azúcar de caña, Agua mineral, Ralladura de limón, Jarabe de glucosa', null],
  9: ['Mascarpone DOP, Espresso ristretto, Savoiardi artesanales, Yemas de huevo, Leche entera, Cacao en polvo', 'Lácteos, Huevo, Gluten, Cafeína'],
  10: ['Leche de coco tailandesa, Lima kaffir, Azúcar de coco, Ralladura de lima, Aceite de coco virgen', 'Coco'],
  11: ['Agua de rosas Damasco, Puré de lichi fresco, Leche entera, Crema de leche, Azúcar de caña', 'Lácteos'],
  12: ['Matcha ceremonial Uji, Leche de avena, Azúcar de caña, Jarabe de arroz, Aceite de coco', 'Avena'],
  13: null, // sin ficha propia: la de "Pistacchio di Bronte" no es suya
};
