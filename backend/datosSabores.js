// Fichas de los sabores: ingredientes, alérgenos y nutrición. Única fuente de la tienda (/api/products) y del chat.
//  - getFlavorData: la tienda; empareja por palabra suelta del nombre (puede prestar la ficha de un sabor parecido).
//  - fichaPropia: el chat; solo si el nombre del producto es EXACTAMENTE el de la ficha (salud: ante la duda, null).

const { soloPalabras } = require('./gelbotIntencion');

// Mapa de datos nutricionales, ingredientes y alérgenos por nombre de producto
const FLAVOR_DATA_MAP = [
  {
    keys: ['fresa'],
    ingredients: ['Fresas silvestres', 'Azúcar de caña', 'Leche entera', 'Crema de leche', 'Vinagre balsámico', 'Zumo de limón'],
    allergens: ['Lácteos'],
    nutrition: { calorias: 210, grasas: 8, carbos: 32, proteinas: 4 },
    flavorProfile: [
      { label: 'Dulzura', value: 75 }, { label: 'Acidez', value: 60 },
      { label: 'Cremosidad', value: 80 }, { label: 'Intensidad', value: 85 },
    ],
    origin: 'Cundinamarca, CO',
  },
  {
    keys: ['chocolate', 'cioccolato'],
    ingredients: ['Cacao 72% Tumaco', 'Azúcar moscabado', 'Leche entera', 'Crema de leche', 'Yemas de huevo', 'Extracto de vainilla'],
    allergens: ['Lácteos', 'Huevo', 'Cacao'],
    nutrition: { calorias: 265, grasas: 14, carbos: 28, proteinas: 5 },
    flavorProfile: [
      { label: 'Dulzura', value: 50 }, { label: 'Amargor', value: 70 },
      { label: 'Cremosidad', value: 90 }, { label: 'Intensidad', value: 95 },
    ],
    origin: 'Tumaco, Nariño CO',
  },
  {
    keys: ['mango'],
    ingredients: ['Mango Tommy Atkins', 'Mango Ataúlfo', 'Azúcar de palma', 'Zumo de maracuyá', 'Zumo de limón'],
    allergens: ['Ninguno'],
    nutrition: { calorias: 160, grasas: 0, carbos: 40, proteinas: 1 },
    flavorProfile: [
      { label: 'Dulzura', value: 85 }, { label: 'Acidez', value: 50 },
      { label: 'Frescura', value: 90 }, { label: 'Intensidad', value: 80 },
    ],
    origin: 'Valle del Cauca, CO',
  },
  {
    keys: ['bosque', 'berries', 'frutos'],
    ingredients: ['Moras de Boyacá', 'Arándanos silvestres', 'Frambuesas', 'Leche entera', 'Crema de leche', 'Azúcar de caña'],
    allergens: ['Lácteos'],
    nutrition: { calorias: 195, grasas: 7, carbos: 30, proteinas: 4 },
    flavorProfile: [
      { label: 'Dulzura', value: 65 }, { label: 'Acidez', value: 70 },
      { label: 'Cremosidad', value: 75 }, { label: 'Intensidad', value: 88 },
    ],
    origin: 'Boyacá, CO',
  },
  {
    keys: ['pistacho', 'pistacchio'],
    ingredients: ['Pistacho DOP Bronte 40%', 'Leche entera', 'Crema de leche', 'Azúcar de caña', 'Yemas de huevo'],
    allergens: ['Pistacho', 'Lácteos', 'Huevo'],
    nutrition: { calorias: 310, grasas: 18, carbos: 26, proteinas: 8 },
    flavorProfile: [
      { label: 'Dulzura', value: 55 }, { label: 'Nuttiness', value: 95 },
      { label: 'Cremosidad', value: 95 }, { label: 'Intensidad', value: 92 },
    ],
    origin: 'Bronte, Sicilia IT',
  },
  {
    keys: ['caramelo'],
    ingredients: ['Azúcar caramelizado', 'Flor de sal La Guajira', 'Leche entera', 'Crema extra grasa', 'Mantequilla artesanal', 'Extracto de vainilla'],
    allergens: ['Lácteos'],
    nutrition: { calorias: 280, grasas: 16, carbos: 35, proteinas: 3 },
    flavorProfile: [
      { label: 'Dulzura', value: 80 }, { label: 'Salinidad', value: 55 },
      { label: 'Cremosidad', value: 95 }, { label: 'Intensidad', value: 85 },
    ],
    origin: 'La Guajira, CO',
  },
  {
    keys: ['vainilla'],
    ingredients: ['Vainilla Bourbon Madagascar', 'Leche entera', 'Crema de leche', 'Yemas de huevo', 'Azúcar de caña'],
    allergens: ['Lácteos', 'Huevo'],
    nutrition: { calorias: 230, grasas: 12, carbos: 27, proteinas: 5 },
    flavorProfile: [
      { label: 'Dulzura', value: 70 }, { label: 'Floral', value: 65 },
      { label: 'Cremosidad', value: 98 }, { label: 'Intensidad', value: 60 },
    ],
    origin: 'Madagascar / Bogotá CO',
  },
  {
    keys: ['limon', 'limone', 'amalfi'],
    ingredients: ['Limón Sfusato Amalfitano IGP', 'Azúcar de caña', 'Agua mineral', 'Ralladura de limón', 'Jarabe de glucosa'],
    allergens: ['Ninguno'],
    nutrition: { calorias: 130, grasas: 0, carbos: 34, proteinas: 0 },
    flavorProfile: [
      { label: 'Dulzura', value: 45 }, { label: 'Acidez', value: 90 },
      { label: 'Frescura', value: 98 }, { label: 'Intensidad', value: 82 },
    ],
    origin: 'Amalfi, Italia / Bogotá CO',
  },
  {
    keys: ['tiramisu', 'tiramisú'],
    ingredients: ['Mascarpone DOP', 'Espresso ristretto', 'Savoiardi artesanales', 'Yemas de huevo', 'Leche entera', 'Cacao en polvo'],
    allergens: ['Lácteos', 'Huevo', 'Gluten', 'Cafeína'],
    nutrition: { calorias: 295, grasas: 17, carbos: 29, proteinas: 6 },
    flavorProfile: [
      { label: 'Dulzura', value: 65 }, { label: 'Café', value: 80 },
      { label: 'Cremosidad', value: 95 }, { label: 'Intensidad', value: 90 },
    ],
    origin: 'Receta veneciana / Bogotá CO',
  },
  {
    keys: ['coco'],
    ingredients: ['Leche de coco tailandesa', 'Lima kaffir', 'Azúcar de coco', 'Ralladura de lima', 'Aceite de coco virgen'],
    allergens: ['Coco'],
    nutrition: { calorias: 200, grasas: 12, carbos: 25, proteinas: 2 },
    flavorProfile: [
      { label: 'Dulzura', value: 60 }, { label: 'Acidez', value: 55 },
      { label: 'Cremosidad', value: 85 }, { label: 'Exotismo', value: 92 },
    ],
    origin: 'Tailandia / Bogotá CO',
  },
  {
    keys: ['rosa', 'lichi'],
    ingredients: ['Agua de rosas Damasco', 'Puré de lichi fresco', 'Leche entera', 'Crema de leche', 'Azúcar de caña'],
    allergens: ['Lácteos'],
    nutrition: { calorias: 215, grasas: 9, carbos: 30, proteinas: 4 },
    flavorProfile: [
      { label: 'Dulzura', value: 70 }, { label: 'Floral', value: 95 },
      { label: 'Cremosidad', value: 80 }, { label: 'Exotismo', value: 97 },
    ],
    origin: 'Damasco SY / Bogotá CO',
  },
  {
    keys: ['matcha'],
    ingredients: ['Matcha ceremonial Uji', 'Leche de avena', 'Azúcar de caña', 'Jarabe de arroz', 'Aceite de coco'],
    allergens: ['Avena'],
    nutrition: { calorias: 175, grasas: 5, carbos: 28, proteinas: 3 },
    flavorProfile: [
      { label: 'Dulzura', value: 35 }, { label: 'Amargor', value: 75 },
      { label: 'Cremosidad', value: 80 }, { label: 'Umami', value: 88 },
    ],
    origin: 'Uji, Kyoto JP / Bogotá CO',
  },
];

// Busca en el mapa de sabores por nombre de producto
function getFlavorData(name) {
  const n = (name || '').toLowerCase();
  const match = FLAVOR_DATA_MAP.find(entry => entry.keys.some(k => n.includes(k)));
  return match || null;
}

// Nombre canónico de cada ficha (sin tildes, mayúsculas ni signos).
// Un sabor nuevo del panel no toma prestada ninguna ficha hasta que su nombre se agregue aquí.
const NOMBRES_DE_FICHA = [
  'fresa salvaje', 'cioccolato nero', 'mango tropical', 'frutos del bosque', 'pistacchio di bronte', 'caramelo salado',
  'vainilla de madagascar', 'limone di amalfi', 'tiramisu artigianale', 'coco lima', 'rosa lichi', 'matcha ceremonial',
];
const FICHA_POR_NOMBRE = new Map(NOMBRES_DE_FICHA.map((nombre) => [nombre, getFlavorData(nombre)]));

function fichaPropia(nombre) {
  return typeof nombre === 'string' ? FICHA_POR_NOMBRE.get(soloPalabras(nombre)) || null : null;
}

module.exports = { FLAVOR_DATA_MAP, getFlavorData, fichaPropia };
