import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { X, Send, Mic, Plus, Check } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { getToken } from '../utils/api';
import { armarTarjetasProductos, productoDeTarjeta, cantidadParaCarrito, FOTO_POR_DEFECTO } from '../utils/tarjetasGelbot';
import { medidasPanel, debeCerrarConEscape, debeDevolverFoco } from '../utils/panelGelbot';

// Medidas actuales de la ventana. alto = vista de diseño (no cambia con el teclado); altoVisible y
// desplazamientoVisible (visualViewport) cambian cuando se abre el teclado del celular.
const leerVentana = () => (typeof window === 'undefined' ? {} : {
  ancho: window.innerWidth,
  alto: document.documentElement.clientHeight || window.innerHeight,
  altoVisible: window.visualViewport?.height,
  desplazamientoVisible: window.visualViewport?.offsetTop,
});

const ANILLO_FOCO = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-premium focus-visible:ring-offset-2 focus-visible:ring-offset-cacao-950';

const parseInlineStyles = (text) => {
  if (typeof text !== 'string') return text;
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-gold-premium font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
};

const renderMessageText = (text) => {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={idx} className="h-1" />;
    
    // Check for bullet list
    const isBullet = trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*');
    if (isBullet) {
      const cleanLine = trimmed.replace(/^[•\-\*]\s*/, '');
      return (
        <div key={idx} className="flex gap-2 ml-2 my-1 items-start text-white/95">
          <span className="text-gold-premium mt-1.5 w-1.5 h-1.5 rounded-full bg-gold-premium flex-shrink-0" />
          <span>{parseInlineStyles(cleanLine)}</span>
        </div>
      );
    }
    
    // Check for section headers (e.g. ══ ROLES ══ or ### Header)
    const isHeader = trimmed.startsWith('###') || trimmed.startsWith('==') || trimmed.startsWith('══');
    if (isHeader) {
      const cleanHeader = trimmed.replace(/[#=═]/g, '').trim();
      return (
        <h5 key={idx} className="text-xs font-bold text-gold-premium uppercase tracking-wider mt-3 mb-1">
          {cleanHeader}
        </h5>
      );
    }
    
    return (
      <p key={idx} className="my-0.5 leading-relaxed text-white/90">
        {parseInlineStyles(line)}
      </p>
    );
  });
};

const Gelbot = ({ user }) => {
  const { addToCart } = useCart();
  const [isOpen, setIsOpen] = useState(false);

  const welcomeMsg = (u) => ({
    id: 1,
    text: u?.rol === 'admin'
      ? `¡Hola Admin ${u?.name || u?.nombre || ''}! Soy Gelbot 🍦 ¿En qué puedo ayudarte hoy a gestionar la tienda?`
      : `¡Hola ${u?.name || u?.nombre || 'Gelattista'}! Soy Gelbot 🍦 ¿En qué puedo ayudarte hoy?`,
    sender: 'bot'
  });

  const [messages, setMessages] = useState([welcomeMsg(user)]);
  const [input, setInput]       = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  // Tarjetas ya agregadas al carrito ("<idMensaje>-<idProducto>"), para mostrar el check.
  const [agregados, setAgregados] = useState(() => new Set());
  const messagesEndRef = useRef(null);
  // Ids de mensaje con un contador (dos mensajes en el mismo milisegundo no chocan).
  const siguienteId = useRef(2);
  const nuevoId = () => siguienteId.current++;
  const recognitionRef = useRef(null);
  const inputRef = useRef(null);
  const botonFlotanteRef = useRef(null);
  const yaSeAbrio = useRef(false);
  const panelRef = useRef(null);
  const devolverFoco = useRef(false);
  const mensajesRef = useRef(messages);
  mensajesRef.current = messages;
  // Temporizadores del auto-cierre (despedida): se limpian si el componente se desmonta.
  const temporizadores = useRef([]);
  useEffect(() => () => temporizadores.current.forEach(clearTimeout), []);
  const reducirMovimiento = useReducedMotion();
  const [ventana, setVentana] = useState(leerVentana);
  const medidas = medidasPanel(ventana);
  const esMovil = medidas.modo === 'movil';

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: reducirMovimiento ? 'auto' : 'smooth', block: 'end' });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isLoading, isOpen]);

  // Panel abierto: seguir el tamaño de la ventana (y del teclado), cerrar con Escape y llevar el foco al campo.
  // Al cerrarlo, el foco vuelve al botón flotante solo si estaba en el panel (no en la primera carga ni si
  // el usuario ya está en otra parte de la página, por ejemplo tras el auto-cierre).
  useEffect(() => {
    if (!isOpen) {
      if (yaSeAbrio.current && devolverFoco.current) botonFlotanteRef.current?.focus();
      devolverFoco.current = false;
      return undefined;
    }
    yaSeAbrio.current = true;
    const actualizar = () => setVentana(leerVentana());
    // Escape no cierra con una confirmación de admin pendiente ni si otro diálogo ya lo atendió.
    const alTeclear = (e) => {
      if (!debeCerrarConEscape(e, mensajesRef.current)) return;
      e.preventDefault();
      setIsOpen(false);
    };
    actualizar();
    window.addEventListener('resize', actualizar);
    window.visualViewport?.addEventListener('resize', actualizar);
    window.visualViewport?.addEventListener('scroll', actualizar);
    document.addEventListener('keydown', alTeclear);
    const enfocar = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => {
      devolverFoco.current = debeDevolverFoco({ activo: document.activeElement, panel: panelRef.current, body: document.body });
      cancelAnimationFrame(enfocar);
      window.removeEventListener('resize', actualizar);
      window.visualViewport?.removeEventListener('resize', actualizar);
      window.visualViewport?.removeEventListener('scroll', actualizar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [isOpen]);

  // En el celular el panel ocupa toda la pantalla: el resto de la app queda inerte (el foco no se escapa
  // detrás del chat). El panel vive fuera de #root (portal), así que no se ve afectado. Al cerrar se restaura.
  const modal = isOpen && medidas.modal;
  useEffect(() => {
    if (!modal) return undefined;
    const raiz = document.getElementById('root');
    if (!raiz) return undefined;
    const anterior = raiz.inert;
    raiz.inert = true;
    return () => { raiz.inert = anterior; };
  }, [modal]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'es-ES';

      recognition.onresult = (event) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setInput(currentTranscript);
      };

      recognition.onerror = (event) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      setInput('');
      recognitionRef.current?.start();
      setIsListening(true);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMsg = { id: nuevoId(), text: input, sender: 'user' };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Enviamos solo los últimos turnos para mantener contexto (el servidor acota igual).
      const chatHistory = messages.slice(-20).map(m => ({
        role:    m.sender === 'bot' ? 'assistant' : 'user',
        content: String(m.text || '')
      }));

      // Quién eres lo decide el servidor con tu token de sesión (nunca datos que mande el navegador).
      const token = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/chatbot`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: input,
          history: chatHistory
        })
      });

      const data = await response.json().catch(() => ({}));

      // 400 (mensaje inválido) y 429 (demasiados mensajes) traen un mensaje en español para mostrar.
      if ((response.status === 400 || response.status === 429) && data.message) {
        setMessages(prev => [...prev, { id: nuevoId(), text: data.message, sender: 'bot' }]);
        return;
      }
      if (!response.ok) {
        throw new Error(`Error del servidor: ${response.status}`);
      }

      if (data.error) throw new Error(data.error);

      // Acción: añadir producto al carrito
      if (data.action === 'addToCart' && data.product) {
        addToCart(data.product, cantidadParaCarrito(data.quantity));
        // Añadimos un mensaje de confirmación si el bot no dio texto
        if (!data.response) {
          data.response = `¡${data.product.nombre} añadido al carrito! 🍦`;
        }
      }

      // Guardar mensaje del bot con metadatos de acción
      const botMsg = {
        id:         nuevoId(),
        text:       data.response || (data.action ? '' : '...'),
        sender:     'bot',
        action:     data.action,
        actionData: data.actionData,
        // Tarjetas con foto (datos de la base, validados otra vez aquí).
        productos:  armarTarjetasProductos(data.productos),
        // Acción que modifica datos: el servidor solo la propone; aquí el admin la confirma o la cancela.
        propuesta:  data.requiereConfirmacion && data.tokenConfirmacion
          ? { token: data.tokenConfirmacion, resumen: String(data.resumen || ''), estado: 'pendiente' }
          : null
      };
      setMessages(prev => [...prev, botMsg]);

      // Acción: cerrar chat automáticamente (despedida)
      if (data.action === 'closeChat') {
        temporizadores.current.push(setTimeout(() => {
          setIsOpen(false);
          temporizadores.current.push(setTimeout(() => {
            setMessages([welcomeMsg(user)]);
          }, 500));
        }, 3500));
      }

    } catch (error) {
      console.error("Error en el chat:", error);
      setMessages(prev => [...prev, {
        id:     nuevoId(),
        text:   'Ups, algo salió mal. Inténtalo de nuevo en un momento.',
        sender: 'bot'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Tocar una tarjeta agrega ese helado al carrito (precio y foto vienen de la base).
  // Una tarjeta ya agregada ignora más toques (evita el doble toque en el celular).
  const agregarDesdeTarjeta = (msgId, tarjeta) => {
    const clave = `${msgId}-${tarjeta.id}`;
    if (agregados.has(clave)) return;
    addToCart(productoDeTarjeta(tarjeta), 1);
    setAgregados(prev => new Set(prev).add(clave));
    setMessages(prev => [...prev, {
      id: nuevoId(),
      text: `¡**${tarjeta.nombre}** (${tarjeta.precioTexto}) añadido al carrito! 🍦`,
      sender: 'bot'
    }]);
  };

  // Responde a una propuesta del servidor: solo manda el token (nunca texto del chat) en una petición nueva.
  const responderPropuesta = async (msgId, token, aceptar) => {
    if (isLoading) return;
    setIsLoading(true);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, propuesta: { ...m.propuesta, estado: 'resuelta' } } : m));
    let texto;
    try {
      const authToken = getToken();
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/chatbot`, {
        method: 'POST',
        headers,
        body: JSON.stringify(aceptar ? { confirmar: token } : { cancelar: token })
      });
      const data = await response.json().catch(() => ({}));
      texto = data.response || data.message || 'No pude completar la acción.';
    } catch (error) {
      console.error('Error al confirmar la acción:', error);
      texto = 'Ups, algo salió mal. Inténtalo de nuevo en un momento.';
    } finally {
      setIsLoading(false);
    }
    setMessages(prev => [...prev, { id: nuevoId(), text: texto, sender: 'bot' }]);
  };

  // Escritorio: panel compacto abajo a la derecha que crece con el contenido hasta un máximo que nunca llega
  // a la barra superior. Celular: toda la pantalla debajo de la barra (la barra y el carrito siguen a la vista):
  // top = barra y bottom = 0; solo con el teclado abierto se fija el alto del área visible.
  const estiloPanel = esMovil
    ? (medidas.alto === undefined
        ? { top: medidas.arriba, bottom: medidas.abajo, left: 0, right: 0 }
        : { top: medidas.arriba, height: medidas.alto, left: 0, right: 0 })
    : { width: medidas.ancho, maxHeight: medidas.altoMax, bottom: medidas.abajo, right: 24, transformOrigin: 'bottom right' };

  const animacion = reducirMovimiento
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
        initial: { opacity: 0, y: esMovil ? 24 : 12, scale: esMovil ? 1 : 0.97 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: esMovil ? 24 : 8, scale: esMovil ? 1 : 0.98, transition: { duration: 0.15, ease: 'easeIn' } },
        transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
      };

  const burbujaBot = 'bg-cacao-700 text-crema border border-white/[0.06] rounded-2xl rounded-bl-md';
  const cajaAdmin = 'w-full bg-cacao-950 border border-gold-premium/15 rounded-xl overflow-hidden mt-1 text-xs';
  const cabeceraAdmin = 'px-3 py-2 bg-cacao-800 border-b border-gold-premium/10 flex justify-between items-center';

  return (
    <>
      {createPortal(<AnimatePresence>
        {isOpen && (
          <motion.section
            ref={panelRef}
            key="panel-gelbot"
            id="gelbot-panel"
            data-gelbot-panel=""
            role="dialog"
            aria-modal={medidas.modal ? 'true' : 'false'}
            aria-labelledby="gelbot-titulo"
            style={estiloPanel}
            {...animacion}
            className={`fixed z-[60] flex flex-col overflow-hidden text-left bg-cacao-900 ${
              esMovil
                ? 'border-t border-gold-premium/20'
                : 'rounded-2xl border border-gold-premium/20 shadow-[0_24px_60px_-18px_rgba(0,0,0,0.8)]'
            }`}
          >
            {/* Encabezado */}
            <header className="flex flex-none items-center justify-between gap-3 pl-4 pr-2 py-3 bg-cacao-950 border-b border-gold-premium/15">
              <div className="flex items-center gap-3 min-w-0">
                <span className="relative flex-none">
                  <img
                    src="/images/gelbot-logo.png"
                    alt=""
                    className="w-10 h-10 rounded-full object-cover bg-background-dark ring-1 ring-gold-premium/70"
                  />
                  <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-cacao-950" />
                </span>
                <div className="min-w-0 leading-tight">
                  <h2 id="gelbot-titulo" className="text-lg font-semibold text-crema tracking-[-0.01em]">Gelbot</h2>
                  <p className="text-xs text-emerald-300">En línea · Asistente de Super Gelatto</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Cerrar chat"
                className={`flex-none w-11 h-11 rounded-full flex items-center justify-center text-crema-suave hover:text-crema hover:bg-white/[0.06] transition-colors ${ANILLO_FOCO}`}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            {/* Mensajes */}
            <div
              className="flex-auto min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-4"
              role="log"
              aria-live="polite"
              aria-label="Conversación con Gelbot"
            >
              {messages.map((msg) => (
                <div key={msg.id} className={`flex flex-col gap-2 ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>

                  {/* Burbuja de texto */}
                  {(msg.sender === 'user' || msg.text) && (
                    <div className={`max-w-[85%] px-3.5 py-2.5 text-sm leading-relaxed break-words ${
                      msg.sender === 'user'
                        ? 'bg-gold-premium text-background-dark font-medium rounded-2xl rounded-br-md'
                        : burbujaBot
                    }`}>
                      {msg.sender === 'user' ? msg.text : renderMessageText(msg.text)}
                    </div>
                  )}

                  {/* ── Confirmación de acción (Admin): texto como texto, nunca como HTML ── */}
                  {msg.propuesta && (
                    <div className="max-w-[90%] bg-cacao-950 border border-gold-premium/40 rounded-xl p-3 text-xs flex flex-col gap-2">
                      <span className="text-crema">{msg.propuesta.resumen}</span>
                      {msg.propuesta.estado === 'pendiente' && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => responderPropuesta(msg.id, msg.propuesta.token, true)}
                            className={`min-h-11 px-4 rounded-full bg-gold-premium text-background-dark font-bold hover:bg-gold-light transition-colors disabled:opacity-50 ${ANILLO_FOCO}`}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => responderPropuesta(msg.id, msg.propuesta.token, false)}
                            className={`min-h-11 px-4 rounded-full bg-cacao-700 text-crema hover:bg-cacao-800 border border-white/10 transition-colors disabled:opacity-50 ${ANILLO_FOCO}`}
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Tarjetas de sabores: foto, nombre y precio; tocar = agregar al carrito ── */}
                  {msg.productos?.length > 0 && (
                    <ul
                      aria-label="Sabores disponibles"
                      className="w-full grid grid-cols-2 gap-2.5"
                    >
                      {msg.productos.map((t) => {
                        const agregado = agregados.has(`${msg.id}-${t.id}`);
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => agregarDesdeTarjeta(msg.id, t)}
                              aria-label={agregado ? `${t.nombre}, ${t.precioTexto}, agregado al carrito` : `Agregar ${t.nombre}, ${t.precioTexto}, al carrito`}
                              aria-disabled={agregado || undefined}
                              className={`group w-full h-full flex flex-col text-left rounded-xl overflow-hidden bg-cacao-800 border transition-colors ${ANILLO_FOCO} ${
                                agregado ? 'border-emerald-400/50 cursor-default' : 'border-white/[0.06] hover:border-gold-premium/60 hover:bg-cacao-700'
                              }`}
                            >
                              <span className="relative block aspect-[4/3] bg-cacao-950 overflow-hidden">
                                <img
                                  src={t.image}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
                                  onError={(e) => {
                                    if (!e.currentTarget.src.endsWith(FOTO_POR_DEFECTO)) e.currentTarget.src = FOTO_POR_DEFECTO;
                                  }}
                                />
                                <span
                                  aria-hidden="true"
                                  className={`absolute bottom-2 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-[0_4px_10px_-2px_rgba(0,0,0,0.6)] transition-colors ${
                                    agregado ? 'bg-emerald-400 text-background-dark' : 'bg-gold-premium text-background-dark'
                                  }`}
                                >
                                  {agregado ? <Check size={16} strokeWidth={3} /> : <Plus size={16} strokeWidth={3} />}
                                </span>
                              </span>
                              <span className="flex flex-col gap-0.5 px-2.5 py-2">
                                <span className="text-[13px] font-semibold text-crema leading-snug line-clamp-2">{t.nombre}</span>
                                <span className="text-xs font-bold text-gold-premium tabular-nums">{t.precioTexto}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* ── Tabla de Usuarios (Admin) ── */}
                  {msg.action === 'showUsersTable' && msg.actionData && (
                    <div className={cajaAdmin}>
                      <div className={cabeceraAdmin}>
                        <span className="font-bold text-gold-premium uppercase tracking-wider text-[10px]">Usuarios</span>
                        <span className="text-crema-suave text-[11px] tabular-nums">{msg.actionData.length} registros</span>
                      </div>
                      <div className="max-h-[200px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-cacao-800 text-crema-suave sticky top-0">
                            <tr>
                              <th className="p-2 font-medium">Nombre</th>
                              <th className="p-2 font-medium">Rol</th>
                            </tr>
                          </thead>
                          <tbody>
                            {msg.actionData.map((u, idx) => (
                              <tr key={idx} className="border-t border-white/5 hover:bg-white/[0.04] transition-colors">
                                <td className="p-2 text-crema">
                                  {u.nombre}
                                  <div className="text-[10px] text-crema-suave truncate max-w-[170px]">{u.email}</div>
                                </td>
                                <td className="p-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
                                    u.rol === 'admin'
                                      ? 'bg-gold-premium/20 text-gold-premium'
                                      : 'bg-white/10 text-crema-suave'
                                  }`}>
                                    {u.rol}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Tabla de Ventas (Admin) ── */}
                  {msg.action === 'showSalesTable' && msg.actionData && (
                    <div className={cajaAdmin}>
                      <div className={cabeceraAdmin}>
                        <span className="font-bold text-gold-premium uppercase tracking-wider text-[10px]">Últimas ventas</span>
                        <span className="text-crema-suave text-[11px] tabular-nums">{msg.actionData.length} registros</span>
                      </div>
                      <div className="max-h-[220px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-cacao-800 text-crema-suave sticky top-0">
                            <tr>
                              <th className="p-2 font-medium">Cliente</th>
                              <th className="p-2 font-medium">Total</th>
                              <th className="p-2 font-medium">Fecha</th>
                            </tr>
                          </thead>
                          <tbody>
                            {msg.actionData.map((s, idx) => (
                              <tr key={idx} className="border-t border-white/5 hover:bg-white/[0.04] transition-colors">
                                <td className="p-2 text-crema">
                                  {s.usuario?.nombre || 'Cliente'}
                                  <div className="text-[10px] text-crema-suave truncate max-w-[120px]">
                                    {s.usuario?.email || (String(s.id_usuario || '').slice(0, 8) + '...')}
                                  </div>
                                </td>
                                <td className="p-2 font-bold text-emerald-300 tabular-nums">
                                  {new Intl.NumberFormat('es-CO', {
                                    style: 'currency', currency: 'COP', minimumFractionDigits: 0
                                  }).format(s.total)}
                                </td>
                                <td className="p-2 text-crema-suave tabular-nums">
                                  {new Date(s.fecha).toLocaleDateString('es-CO', {
                                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                  })}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Tabla Dinámica (Admin) ── */}
                  {msg.action === 'showTable' && Array.isArray(msg.actionData) && msg.actionData.length > 0 && (
                    <div className={`${cajaAdmin} text-[11px]`}>
                      <div className={cabeceraAdmin}>
                        <span className="font-bold text-gold-premium uppercase tracking-wider text-[10px]">Consulta a la base de datos</span>
                        <span className="text-crema-suave text-[11px] tabular-nums">{msg.actionData.length} filas</span>
                      </div>
                      <div className="max-h-[220px] overflow-x-auto overflow-y-auto">
                        <table className="w-full text-left border-collapse min-w-[320px]">
                          <thead className="bg-cacao-800 text-crema-suave sticky top-0">
                            <tr>
                              {Object.keys(msg.actionData[0]).map((header) => (
                                <th key={header} className="p-2 font-semibold border-b border-white/10 text-[10px] tracking-wider uppercase">
                                  {header.replace(/_/g, ' ')}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {msg.actionData.map((row, idx) => (
                              <tr key={idx} className="border-t border-white/5 hover:bg-white/[0.04] transition-colors">
                                {Object.values(row).map((val, cellIdx) => {
                                  let displayVal = val;
                                  if (typeof val === 'boolean') {
                                    displayVal = val ? 'Sí' : 'No';
                                  } else if (val === null || val === undefined) {
                                    displayVal = '-';
                                  } else if (typeof val === 'object') {
                                    displayVal = JSON.stringify(val);
                                  }

                                  const keyName = Object.keys(row)[cellIdx].toLowerCase();
                                  const isCountField = /ventas|pedidos|usuarios|clientes|productos|cantidad|count|numero|num|id/i.test(keyName);
                                  if (typeof val === 'number' && !isCountField && (keyName.includes('total') || keyName.includes('precio') || keyName.includes('salario') || keyName.includes('ingresos') || keyName.includes('puntos'))) {
                                    displayVal = new Intl.NumberFormat('es-CO', {
                                      style: 'currency', currency: 'COP', minimumFractionDigits: 0
                                    }).format(val);
                                  } else if (keyName.includes('fecha') && val && !isNaN(Date.parse(val))) {
                                    displayVal = new Date(val).toLocaleDateString('es-CO', {
                                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                                    });
                                  }

                                  return (
                                    <td key={cellIdx} className="p-2 text-crema truncate max-w-[150px] tabular-nums" title={String(displayVal)}>
                                      {displayVal}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                </div>
              ))}

              {/* Indicador de "escribiendo" */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className={`${burbujaBot} px-4 py-3`} aria-label="Gelbot está escribiendo" role="status">
                    <div className="flex gap-1.5" aria-hidden="true">
                      <span className="w-1.5 h-1.5 bg-gold-premium rounded-full motion-safe:animate-pulse" />
                      <span className="w-1.5 h-1.5 bg-gold-premium rounded-full motion-safe:animate-pulse [animation-delay:0.2s]" />
                      <span className="w-1.5 h-1.5 bg-gold-premium rounded-full motion-safe:animate-pulse [animation-delay:0.4s]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Campo de texto: pegado abajo, respeta la zona segura del celular */}
            <form
              onSubmit={handleSend}
              className="flex flex-none items-center gap-2 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-cacao-950 border-t border-gold-premium/15"
            >
              <button
                type="button"
                onClick={toggleListening}
                aria-label={isListening ? 'Detener micrófono' : 'Hablar con el micrófono'}
                aria-pressed={isListening}
                title={isListening ? 'Detener micrófono' : 'Usar micrófono'}
                className={`flex-none w-11 h-11 rounded-full flex items-center justify-center transition-colors ${ANILLO_FOCO} ${
                  isListening ? 'bg-red-500/15 text-red-400 motion-safe:animate-pulse' : 'bg-cacao-800 text-crema-suave hover:text-crema hover:bg-cacao-700'
                }`}
              >
                <Mic size={18} aria-hidden="true" />
              </button>
              <input
                ref={inputRef}
                type="text"
                aria-label="Escribe tu mensaje para Gelbot"
                placeholder={isListening ? 'Escuchando...' : 'Pregunta algo...'}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 min-w-0 h-11 rounded-full bg-cacao-800 border border-white/10 px-4 text-base sm:text-sm text-crema placeholder:text-crema-suave caret-gold-premium transition-colors focus:outline-none focus-visible:border-gold-premium/70 focus-visible:ring-2 focus-visible:ring-gold-premium/30"
              />
              <button
                type="submit"
                aria-label="Enviar mensaje"
                disabled={!input.trim() || isLoading}
                className={`flex-none w-11 h-11 rounded-full flex items-center justify-center bg-gold-premium text-background-dark transition-colors hover:bg-gold-light disabled:bg-cacao-800 disabled:text-crema-suave/80 disabled:cursor-not-allowed ${ANILLO_FOCO}`}
              >
                <Send size={18} aria-hidden="true" />
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>, document.body)}

      {/* Botón flotante: abre el chat; mientras está abierto se oculta (se cierra con la X o con Escape) */}
      <button
        ref={botonFlotanteRef}
        type="button"
        data-gelbot-toggle=""
        onClick={() => setIsOpen(true)}
        aria-label="Abrir chat con Gelbot"
        aria-expanded={isOpen}
        aria-controls="gelbot-panel"
        aria-hidden={isOpen || undefined}
        tabIndex={isOpen ? -1 : 0}
        inert={isOpen || undefined}
        title="Chatea con Gelbot"
        className={`fixed right-6 bottom-[max(1.5rem,env(safe-area-inset-bottom))] z-[60] w-16 h-16 p-0 rounded-full overflow-hidden bg-background-dark border-2 border-gold-premium shadow-[0_12px_28px_-10px_rgba(0,0,0,0.8)] transition-[opacity,transform,box-shadow] duration-200 ease-out hover:shadow-[0_14px_32px_-10px_rgba(212,175,55,0.45)] motion-safe:hover:scale-105 motion-safe:active:scale-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-gold-premium/50 ${
          isOpen ? 'opacity-0 scale-90 pointer-events-none' : 'opacity-100 scale-100'
        }`}
      >
        <img src="/images/gelbot-logo.png" alt="" className="w-full h-full object-cover" />
      </button>
    </>
  );
};

export default Gelbot;
