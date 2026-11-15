/* ==========================================================================
   CHILE · RAIN TRENDS
   NASA Space Apps Challenge 2026 · Be An Earth System Trend Detective!
   Lógica principal: carga de CSV, estadística de tendencias, mapa,
   dashboard, gráfico Plotly, hallazgos y animaciones.
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. CONFIGURACIÓN
   ========================================================================== */
const CONFIG = {
  zonas: {
    norte: {
      nombre: 'Norte',
      archivo: 'data/norte_precipitacion_promedio_anual_1970_2025.csv',
      color: '#f59e0b',
      descripcion: 'Zona árida y semiárida, con precipitaciones escasas y alta variabilidad interanual.'
    },
    centro: {
      nombre: 'Centro',
      archivo: 'data/centro_precipitacion_promedio_anual_1970_2025.csv',
      color: '#22d3ee',
      descripcion: 'Clima de tipo mediterráneo, con lluvias concentradas en los meses de invierno.'
    },
    sur: {
      nombre: 'Sur',
      archivo: 'data/sur_precipitacion_promedio_anual_1970_2025.csv',
      color: '#818cf8',
      descripcion: 'Clima templado lluvioso, con las mayores precipitaciones anuales del país.'
    }
  },

  /* ------------------------------------------------------------------------
     CONEXIÓN DE DATOS
     Columnas reales de los CSV (mismas en norte, centro y sur):
       anio                       → año (entero, 1970 a 2025)
       precipitacion_promedio_mm  → precipitación promedio anual en mm
     Si alguna columna no se encuentra, el código intenta detectarla
     automáticamente como respaldo.
     ------------------------------------------------------------------------ */
  columnaAnio: 'anio',
  columnaPrecip: 'precipitacion_promedio_mm',

  unidad: 'mm',
  zonaInicial: 'centro',
  ventanaMediaMovil: 5,
  aniosPorDecada: 10,
  alfa: 0.05,

  /* ------------------------------------------------------------------------
     PUNTO DE INTEGRACIÓN GEOJSON (opcional)
     Mientras url sea null se usa el esquema SVG del index.html.
     Para usar un GeoJSON real:
       url: 'data/zonas_chile.geojson',
       propiedadZona: 'zona'   // propiedad de cada feature con valor
                               // 'norte', 'centro' o 'sur'
     ------------------------------------------------------------------------ */
  geojson: {
    url: null,
    propiedadZona: 'zona'
  }
};

/* ==========================================================================
   2. ESTADO GLOBAL
   ========================================================================== */
const estado = {
  zonaActiva: CONFIG.zonaInicial,
  datos: {},               // datos[clave] = { anios, valores, stats, columnas } o { error }
  vista: 'serie',          // 'serie' | 'anomalias'
  mostrarTendencia: true,
  mostrarMediaMovil: true,
  compararZonas: false,
  graficoIniciado: false
};

/* ==========================================================================
   3. UTILIDADES
   ========================================================================== */
const $ = (selector, raiz = document) => raiz.querySelector(selector);
const $$ = (selector, raiz = document) => Array.from(raiz.querySelectorAll(selector));

function formatearNumero(valor, decimales = 1) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  return valor.toLocaleString('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales
  });
}

function formatearConSigno(valor, decimales = 1) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return '—';
  const signo = valor > 0 ? '+' : '';
  return signo + formatearNumero(valor, decimales);
}

function formatearPValor(p) {
  if (p === null || Number.isNaN(p)) return '—';
  if (p < 0.001) return '< 0,001';
  return formatearNumero(p, 3);
}

function hexARgba(hex, alfa) {
  const limpio = hex.replace('#', '');
  const r = parseInt(limpio.substring(0, 2), 16);
  const g = parseInt(limpio.substring(2, 4), 16);
  const b = parseInt(limpio.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

function normalizarTexto(texto) {
  return String(texto)
    .trim()
    .replace(/^﻿/, '')
    .replace(/^"|"$/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const prefiereMenosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ==========================================================================
   4. LECTURA Y PARSEO DE CSV
   ========================================================================== */

/** Detecta el separador más frecuente en la línea de encabezados. */
function detectarDelimitador(linea) {
  const candidatos = [',', ';', '\t', '|'];
  let mejor = ',';
  let maxConteo = 0;
  for (let i = 0; i < candidatos.length; i++) {
    const conteo = linea.split(candidatos[i]).length - 1;
    if (conteo > maxConteo) {
      maxConteo = conteo;
      mejor = candidatos[i];
    }
  }
  return mejor;
}

/** Divide una línea respetando comillas dobles. */
function dividirLinea(linea, delimitador) {
  const campos = [];
  let actual = '';
  let dentroComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const caracter = linea[i];
    if (caracter === '"') {
      dentroComillas = !dentroComillas;
    } else if (caracter === delimitador && !dentroComillas) {
      campos.push(actual);
      actual = '';
    } else {
      actual += caracter;
    }
  }
  campos.push(actual);
  return campos.map(campo => campo.trim());
}

/** Convierte texto a número aceptando coma o punto decimal. */
function parsearNumero(texto) {
  if (texto === undefined || texto === null) return NaN;
  let limpio = String(texto).trim().replace(/"/g, '');
  if (limpio === '' || /^(na|nan|null|-|—)$/i.test(limpio)) return NaN;
  const tienePunto = limpio.includes('.');
  const tieneComa = limpio.includes(',');
  if (tienePunto && tieneComa) {
    if (limpio.lastIndexOf(',') > limpio.lastIndexOf('.')) {
      // Formato 1.234,5 → 1234.5
      limpio = limpio.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato 1,234.5 → 1234.5
      limpio = limpio.replace(/,/g, '');
    }
  } else if (tieneComa) {
    limpio = limpio.replace(',', '.');
  }
  return Number(limpio);
}

/** Extrae el año desde un número o una fecha (1970, 1970-01-01, 01/01/1970). */
function parsearAnio(texto) {
  const coincidencia = String(texto).match(/(1[89]\d{2}|20\d{2}|2100)/);
  return coincidencia ? Number(coincidencia[1]) : NaN;
}

function parsearCSV(texto) {
  const lineas = texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(linea => linea.trim() !== '' && !linea.trim().startsWith('#'));

  if (lineas.length < 2) throw new Error('El archivo no contiene filas de datos.');

  const delimitador = detectarDelimitador(lineas[0]);
  const encabezados = dividirLinea(lineas[0], delimitador).map(h => h.replace(/^﻿/, '').replace(/"/g, ''));
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    filas.push(dividirLinea(lineas[i], delimitador));
  }
  return { encabezados, filas, delimitador };
}

/** Identifica los índices de la columna de año y de precipitación. */
function detectarColumnas(encabezados, filas) {
  const normalizados = encabezados.map(normalizarTexto);
  let indiceAnio = -1;
  let indicePrecip = -1;

  // 1) Nombres definidos manualmente en CONFIG
  if (CONFIG.columnaAnio) {
    indiceAnio = normalizados.indexOf(normalizarTexto(CONFIG.columnaAnio));
  }
  if (CONFIG.columnaPrecip) {
    indicePrecip = normalizados.indexOf(normalizarTexto(CONFIG.columnaPrecip));
  }

  // 2) Detección por nombre del encabezado
  const patronAnio = /^(ano|anio|anno|year|yr|fecha|date|periodo|time)$|(^|_)(ano|anio|year)(_|$)/;
  const patronPrecip = /precip|^pp|_pp|prcp|lluvia|rain|mm|valor|value|promedio|mean/;

  if (indiceAnio === -1) {
    for (let i = 0; i < normalizados.length; i++) {
      if (patronAnio.test(normalizados[i])) { indiceAnio = i; break; }
    }
  }

  // 3) Detección por contenido: enteros con forma de año
  if (indiceAnio === -1) {
    for (let i = 0; i < encabezados.length; i++) {
      let aciertos = 0;
      for (let f = 0; f < filas.length; f++) {
        const valor = parsearNumero(filas[f][i]);
        if (Number.isInteger(valor) && valor >= 1800 && valor <= 2100) aciertos++;
      }
      if (aciertos >= filas.length * 0.9) { indiceAnio = i; break; }
    }
  }

  if (indicePrecip === -1) {
    for (let i = 0; i < normalizados.length; i++) {
      if (i !== indiceAnio && patronPrecip.test(normalizados[i])) { indicePrecip = i; break; }
    }
  }

  if (indicePrecip === -1) {
    for (let i = 0; i < encabezados.length; i++) {
      if (i === indiceAnio) continue;
      let numericos = 0;
      for (let f = 0; f < filas.length; f++) {
        if (!Number.isNaN(parsearNumero(filas[f][i]))) numericos++;
      }
      if (numericos >= filas.length * 0.8) { indicePrecip = i; break; }
    }
  }

  if (indiceAnio === -1 || indicePrecip === -1) {
    throw new Error(
      `No se identificaron las columnas. Encabezados encontrados: [${encabezados.join(', ')}]. ` +
      'Definir CONFIG.columnaAnio y CONFIG.columnaPrecip en js/script.js.'
    );
  }

  return {
    indiceAnio,
    indicePrecip,
    nombreAnio: encabezados[indiceAnio],
    nombrePrecip: encabezados[indicePrecip]
  };
}

/** Construye la serie anual ordenada. Si hay varias filas por año, las promedia. */
function construirSerie(filas, columnas) {
  const acumulado = new Map();
  for (let f = 0; f < filas.length; f++) {
    const anio = parsearAnio(filas[f][columnas.indiceAnio]);
    const valor = parsearNumero(filas[f][columnas.indicePrecip]);
    if (Number.isNaN(anio) || Number.isNaN(valor)) continue;
    if (!acumulado.has(anio)) acumulado.set(anio, { suma: 0, conteo: 0 });
    const registro = acumulado.get(anio);
    registro.suma += valor;
    registro.conteo += 1;
  }

  const aniosOrdenados = Array.from(acumulado.keys()).sort((a, b) => a - b);
  const anios = [];
  const valores = [];
  let hayDuplicados = false;
  for (let i = 0; i < aniosOrdenados.length; i++) {
    const registro = acumulado.get(aniosOrdenados[i]);
    if (registro.conteo > 1) hayDuplicados = true;
    anios.push(aniosOrdenados[i]);
    valores.push(registro.suma / registro.conteo);
  }

  if (hayDuplicados) {
    console.warn('[datos] Se encontraron varias filas por año; se promediaron.');
  }
  if (anios.length < 3) throw new Error('La serie tiene menos de 3 años válidos.');

  return { anios, valores };
}

async function cargarZona(clave) {
  const zona = CONFIG.zonas[clave];
  const respuesta = await fetch(zona.archivo, { cache: 'no-cache' });
  if (!respuesta.ok) throw new Error(`No se pudo leer ${zona.archivo} (HTTP ${respuesta.status}).`);
  const texto = await respuesta.text();
  const { encabezados, filas } = parsearCSV(texto);
  const columnas = detectarColumnas(encabezados, filas);
  const { anios, valores } = construirSerie(filas, columnas);
  const stats = calcularEstadisticas(anios, valores);
  return { anios, valores, stats, columnas };
}

async function cargarTodosLosDatos() {
  const claves = Object.keys(CONFIG.zonas);
  const resultados = await Promise.allSettled(claves.map(cargarZona));
  for (let i = 0; i < claves.length; i++) {
    if (resultados[i].status === 'fulfilled') {
      estado.datos[claves[i]] = resultados[i].value;
    } else {
      estado.datos[claves[i]] = { error: resultados[i].reason.message || String(resultados[i].reason) };
      console.error(`[datos] ${claves[i]}:`, resultados[i].reason);
    }
  }
}

/* ==========================================================================
   5. ESTADÍSTICA DE TENDENCIAS
   ========================================================================== */
function calcularMedia(valores) {
  let suma = 0;
  for (let i = 0; i < valores.length; i++) suma += valores[i];
  return suma / valores.length;
}

function calcularDesviacion(valores) {
  const promedio = calcularMedia(valores);
  let sumaCuadrados = 0;
  for (let i = 0; i < valores.length; i++) {
    const dif = valores[i] - promedio;
    sumaCuadrados += dif * dif;
  }
  return Math.sqrt(sumaCuadrados / (valores.length - 1));
}

/** Regresión lineal por mínimos cuadrados. */
function regresionLineal(x, y) {
  const n = x.length;
  const x_promedio = calcularMedia(x);
  const y_promedio = calcularMedia(y);

  let Sxy = 0;
  let Sxx = 0;
  for (let i = 0; i < n; i++) {
    const dif_x = x[i] - x_promedio;
    const dif_y = y[i] - y_promedio;
    Sxy += dif_x * dif_y;
    Sxx += dif_x * dif_x;
  }

  const pendiente = Sxy / Sxx;
  const intercepto = y_promedio - pendiente * x_promedio;

  let SS_res = 0;
  let SS_tot = 0;
  for (let i = 0; i < n; i++) {
    const y_hat = intercepto + pendiente * x[i];
    SS_res += (y[i] - y_hat) * (y[i] - y_hat);
    SS_tot += (y[i] - y_promedio) * (y[i] - y_promedio);
  }
  const r2 = SS_tot > 0 ? 1 - SS_res / SS_tot : 0;

  return { pendiente, intercepto, r2 };
}

/** Pendiente de Sen: mediana de las pendientes entre todos los pares. */
function pendienteSen(x, y) {
  const pendientes = [];
  for (let i = 0; i < x.length - 1; i++) {
    for (let j = i + 1; j < x.length; j++) {
      if (x[j] !== x[i]) pendientes.push((y[j] - y[i]) / (x[j] - x[i]));
    }
  }
  pendientes.sort((a, b) => a - b);
  const mitad = Math.floor(pendientes.length / 2);
  const pendiente = pendientes.length % 2 === 0
    ? (pendientes[mitad - 1] + pendientes[mitad]) / 2
    : pendientes[mitad];

  // Intercepto de Sen: mediana de (y - pendiente * x)
  const residuos = [];
  for (let i = 0; i < x.length; i++) residuos.push(y[i] - pendiente * x[i]);
  residuos.sort((a, b) => a - b);
  const m = Math.floor(residuos.length / 2);
  const intercepto = residuos.length % 2 === 0 ? (residuos[m - 1] + residuos[m]) / 2 : residuos[m];

  return { pendiente, intercepto };
}

/** Función de error (aproximación de Abramowitz y Stegun 7.1.26). */
function erf(x) {
  const signo = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const polinomio = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return signo * (1 - polinomio * Math.exp(-a * a));
}

function cdfNormal(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Test de Mann-Kendall con corrección por empates. */
function testMannKendall(y) {
  const n = y.length;
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dif = y[j] - y[i];
      if (dif > 0) S += 1;
      else if (dif < 0) S -= 1;
    }
  }

  const conteos = new Map();
  for (let i = 0; i < n; i++) conteos.set(y[i], (conteos.get(y[i]) || 0) + 1);
  let correccionEmpates = 0;
  conteos.forEach(t => {
    if (t > 1) correccionEmpates += t * (t - 1) * (2 * t + 5);
  });

  const varS = (n * (n - 1) * (2 * n + 5) - correccionEmpates) / 18;
  let Z = 0;
  if (S > 0) Z = (S - 1) / Math.sqrt(varS);
  else if (S < 0) Z = (S + 1) / Math.sqrt(varS);

  const p = 2 * (1 - cdfNormal(Math.abs(Z)));
  const tau = S / (n * (n - 1) / 2);

  return { S, Z, p, tau, significativo: p < CONFIG.alfa };
}

/** Media móvil centrada; los extremos sin ventana completa quedan en null. */
function mediaMovilCentrada(valores, ventana) {
  const mitad = Math.floor(ventana / 2);
  const resultado = [];
  for (let i = 0; i < valores.length; i++) {
    if (i - mitad < 0 || i + mitad >= valores.length) {
      resultado.push(null);
      continue;
    }
    let suma = 0;
    for (let k = i - mitad; k <= i + mitad; k++) suma += valores[k];
    resultado.push(suma / (2 * mitad + 1));
  }
  return resultado;
}

function calcularEstadisticas(anios, valores) {
  const n = valores.length;
  const media = calcularMedia(valores);
  const desviacion = calcularDesviacion(valores);
  const regresion = regresionLineal(anios, valores);
  const sen = pendienteSen(anios, valores);
  const mk = testMannKendall(valores);

  // Extremos
  let indiceMax = 0;
  let indiceMin = 0;
  for (let i = 1; i < n; i++) {
    if (valores[i] > valores[indiceMax]) indiceMax = i;
    if (valores[i] < valores[indiceMin]) indiceMin = i;
  }

  // Primera vs última década
  const largoDecada = CONFIG.aniosPorDecada;
  let cambioDecadalPct = null;
  let mediaPrimera = null;
  let mediaUltima = null;
  if (n >= largoDecada * 2) {
    mediaPrimera = calcularMedia(valores.slice(0, largoDecada));
    mediaUltima = calcularMedia(valores.slice(n - largoDecada));
    cambioDecadalPct = mediaPrimera !== 0 ? (mediaUltima - mediaPrimera) / mediaPrimera * 100 : null;
  }

  // Anomalías respecto de la media del periodo
  const anomalias = [];
  const anomaliasPct = [];
  for (let i = 0; i < n; i++) {
    anomalias.push(valores[i] - media);
    anomaliasPct.push(media !== 0 ? (valores[i] - media) / media * 100 : 0);
  }

  const senPorDecada = sen.pendiente * CONFIG.aniosPorDecada;

  return {
    n,
    anioInicio: anios[0],
    anioFin: anios[n - 1],
    media,
    desviacion,
    regresion,
    tendenciaPorDecada: regresion.pendiente * CONFIG.aniosPorDecada,
    sen,
    senPorDecada,
    senRelativoPct: media !== 0 ? senPorDecada / media * 100 : null,
    mk,
    max: { anio: anios[indiceMax], valor: valores[indiceMax] },
    min: { anio: anios[indiceMin], valor: valores[indiceMin] },
    mediaPrimera,
    mediaUltima,
    cambioDecadalPct,
    anomalias,
    anomaliasPct,
    mediaMovil: mediaMovilCentrada(valores, CONFIG.ventanaMediaMovil)
  };
}

/** Clasifica la dirección de la tendencia. */
function clasificarTendencia(stats) {
  if (!stats) return { clase: 'is-flat', icono: '◌', texto: 'Sin datos' };
  const direccion = stats.senPorDecada < 0 ? 'down' : stats.senPorDecada > 0 ? 'up' : 'flat';
  if (direccion === 'flat') return { clase: 'is-flat', icono: '→', texto: 'Sin tendencia' };
  const etiqueta = direccion === 'down' ? 'Tendencia a la baja' : 'Tendencia al alza';
  return {
    clase: `is-${direccion}`,
    icono: direccion === 'down' ? '↘' : '↗',
    texto: stats.mk.significativo ? `${etiqueta} · significativa` : `${etiqueta} · no significativa`
  };
}

/* ==========================================================================
   6. NAVEGACIÓN
   ========================================================================== */
function iniciarNavegacion() {
  const nav = $('#nav');
  const toggle = $('#nav-toggle');
  const menu = $('#nav-menu');

  const alHacerScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 20);
  window.addEventListener('scroll', alHacerScroll, { passive: true });
  alHacerScroll();

  toggle.addEventListener('click', () => {
    const abierto = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!abierto));
    menu.classList.toggle('is-open', !abierto);
  });

  $$('.nav__link').forEach(enlace => {
    enlace.addEventListener('click', () => {
      toggle.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
    });
  });

  // Resaltar la sección visible
  const secciones = $$('main section[id]');
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (!entrada.isIntersecting) return;
      $$('.nav__link').forEach(enlace => {
        enlace.classList.toggle('is-active', enlace.getAttribute('href') === `#${entrada.target.id}`);
      });
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  secciones.forEach(seccion => observador.observe(seccion));
}

/* ==========================================================================
   7. FONDO ESTELAR DEL HERO
   ========================================================================== */
function iniciarStarfield() {
  const canvas = $('#starfield');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const hero = $('.hero');
  let estrellas = [];
  let fugaces = [];
  let ancho = 0;
  let alto = 0;
  let activo = true;
  let idAnimacion = null;

  function redimensionar() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ancho = hero.clientWidth;
    alto = hero.clientHeight;
    canvas.width = ancho * dpr;
    canvas.height = alto * dpr;
    canvas.style.width = `${ancho}px`;
    canvas.style.height = `${alto}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cantidad = Math.min(Math.floor((ancho * alto) / 2600), 520);
    estrellas = [];
    for (let i = 0; i < cantidad; i++) {
      estrellas.push({
        x: Math.random() * ancho,
        y: Math.random() * alto,
        radio: Math.random() * 1.3 + 0.2,
        alfaBase: Math.random() * 0.6 + 0.25,
        fase: Math.random() * Math.PI * 2,
        velocidadBrillo: Math.random() * 0.02 + 0.004,
        deriva: Math.random() * 0.06 + 0.01,
        azulada: Math.random() < 0.3
      });
    }
  }

  function crearFugaz() {
    fugaces.push({
      x: Math.random() * ancho * 0.7 + ancho * 0.3,
      y: Math.random() * alto * 0.4,
      largo: Math.random() * 90 + 60,
      velocidad: Math.random() * 6 + 7,
      vida: 1
    });
  }

  function dibujar() {
    ctx.clearRect(0, 0, ancho, alto);

    for (let i = 0; i < estrellas.length; i++) {
      const e = estrellas[i];
      e.fase += e.velocidadBrillo;
      e.x -= e.deriva;
      if (e.x < -2) e.x = ancho + 2;
      const alfa = e.alfaBase * (0.65 + 0.35 * Math.sin(e.fase));
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radio, 0, Math.PI * 2);
      ctx.fillStyle = e.azulada ? `rgba(147, 197, 253, ${alfa})` : `rgba(230, 237, 255, ${alfa})`;
      ctx.fill();
    }

    if (Math.random() < 0.004) crearFugaz();
    for (let i = fugaces.length - 1; i >= 0; i--) {
      const f = fugaces[i];
      const gradiente = ctx.createLinearGradient(f.x, f.y, f.x + f.largo, f.y - f.largo * 0.45);
      gradiente.addColorStop(0, `rgba(255, 255, 255, ${f.vida})`);
      gradiente.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.strokeStyle = gradiente;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(f.x + f.largo, f.y - f.largo * 0.45);
      ctx.stroke();
      f.x -= f.velocidad;
      f.y += f.velocidad * 0.45;
      f.vida -= 0.018;
      if (f.vida <= 0) fugaces.splice(i, 1);
    }

    if (activo) idAnimacion = requestAnimationFrame(dibujar);
  }

  redimensionar();

  if (prefiereMenosMovimiento) {
    activo = false;
    dibujar();
    return;
  }

  dibujar();

  // Pausar cuando el hero no está visible
  new IntersectionObserver(([entrada]) => {
    if (entrada.isIntersecting && !activo) {
      activo = true;
      idAnimacion = requestAnimationFrame(dibujar);
    } else if (!entrada.isIntersecting) {
      activo = false;
      cancelAnimationFrame(idAnimacion);
    }
  }).observe(hero);

  let temporizador;
  window.addEventListener('resize', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(redimensionar, 150);
  });
}

/* ==========================================================================
   8. ANIMACIONES DE APARICIÓN
   ========================================================================== */
function iniciarReveal() {
  const elementos = $$('.reveal');

  // Retraso escalonado entre hermanos
  elementos.forEach(el => {
    const hermanos = $$(':scope > .reveal', el.parentElement);
    const indice = hermanos.indexOf(el);
    if (indice > 0) el.style.setProperty('--reveal-delay', `${Math.min(indice * 0.08, 0.4)}s`);
  });

  if (!('IntersectionObserver' in window)) {
    elementos.forEach(el => el.classList.add('is-visible'));
    return;
  }

  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add('is-visible');
        observador.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  elementos.forEach(el => observador.observe(el));
}

/** Anima un número desde su valor actual hasta el valor final. */
function animarNumero(elemento, valorFinal, formateador) {
  if (valorFinal === null || valorFinal === undefined || Number.isNaN(valorFinal)) {
    elemento.textContent = '—';
    elemento.dataset.valor = '';
    return;
  }

  const valorInicial = Number(elemento.dataset.valor) || 0;
  elemento.dataset.valor = String(valorFinal);

  if (prefiereMenosMovimiento) {
    elemento.textContent = formateador(valorFinal);
    return;
  }

  const duracion = 900;
  const inicio = performance.now();

  function paso(ahora) {
    const progreso = Math.min((ahora - inicio) / duracion, 1);
    const suavizado = 1 - Math.pow(1 - progreso, 3);
    const valorActual = valorInicial + (valorFinal - valorInicial) * suavizado;
    elemento.textContent = formateador(valorActual);
    if (progreso < 1) requestAnimationFrame(paso);
    else elemento.textContent = formateador(valorFinal);
  }
  requestAnimationFrame(paso);
}

/* ==========================================================================
   9. SELECTOR DE ZONA Y MAPA
   ========================================================================== */
function iniciarSelectores() {
  $$('.zone-btn').forEach(boton => {
    boton.addEventListener('click', () => seleccionarZona(boton.dataset.zona));
  });

  const tooltip = $('#mapa-tooltip');
  const contenedorMapa = $('#mapa-esquema');

  $$('.zona-shape').forEach(forma => {
    forma.addEventListener('click', () => seleccionarZona(forma.dataset.zona));

    forma.addEventListener('mousemove', evento => {
      const clave = forma.dataset.zona;
      const datos = estado.datos[clave];
      const zona = CONFIG.zonas[clave];
      let detalle = 'Datos no disponibles';
      if (datos && datos.stats) {
        detalle = `Media ${formatearNumero(datos.stats.media, 0)} ${CONFIG.unidad}/año · Sen ${formatearConSigno(datos.stats.senPorDecada, 1)} ${CONFIG.unidad}/déc`;
      }
      tooltip.innerHTML = `<strong style="color:${zona.color}">${zona.nombre}</strong>${detalle}`;
      const rect = contenedorMapa.getBoundingClientRect();
      let x = evento.clientX - rect.left + 14;
      const y = evento.clientY - rect.top - 10;
      if (x + 230 > rect.width) x = Math.max(4, evento.clientX - rect.left - 240);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
      tooltip.classList.add('is-visible');
    });

    forma.addEventListener('mouseleave', () => tooltip.classList.remove('is-visible'));
  });

  window.addEventListener('resize', posicionarIndicador);
  posicionarIndicador();
}

function posicionarIndicador() {
  const activo = $('.zone-btn.is-active');
  const indicador = $('#zone-indicator');
  if (!activo || !indicador) return;
  indicador.style.width = `${activo.offsetWidth}px`;
  indicador.style.transform = `translateX(${activo.offsetLeft - 6}px)`;
}

function seleccionarZona(clave) {
  if (!CONFIG.zonas[clave]) return;
  estado.zonaActiva = clave;

  $$('.zone-btn').forEach(boton => {
    const activo = boton.dataset.zona === clave;
    boton.classList.toggle('is-active', activo);
    boton.setAttribute('aria-selected', String(activo));
  });
  posicionarIndicador();

  $$('.zona-shape').forEach(forma => forma.classList.toggle('is-active', forma.dataset.zona === clave));
  $$('.zona-label').forEach((etiqueta, i) => {
    etiqueta.classList.toggle('is-active', Object.keys(CONFIG.zonas)[i] === clave);
  });

  actualizarDashboard();
  actualizarGrafico();
  resaltarZonaGeoJSON();
}

/** Escribe la tendencia de cada zona junto al esquema del mapa. */
function actualizarEtiquetasMapa() {
  Object.keys(CONFIG.zonas).forEach(clave => {
    const etiqueta = $(`#mapa-valor-${clave}`);
    if (!etiqueta) return;
    const datos = estado.datos[clave];
    etiqueta.classList.remove('is-up', 'is-down');
    if (!datos || !datos.stats) {
      etiqueta.textContent = 'sin datos';
      return;
    }
    const valor = datos.stats.senPorDecada;
    etiqueta.textContent = `${formatearConSigno(valor, 1)} ${CONFIG.unidad}/déc`;
    etiqueta.classList.add(valor < 0 ? 'is-down' : 'is-up');
  });
}

/* --------------------------------------------------------------------------
   PUNTO DE INTEGRACIÓN GEOJSON
   Solo se ejecuta si CONFIG.geojson.url tiene un archivo real.
   Usa Plotly (choropleth) para no agregar dependencias.
   -------------------------------------------------------------------------- */
async function inicializarMapaGeoJSON() {
  if (!CONFIG.geojson.url || typeof Plotly === 'undefined') return;

  try {
    const respuesta = await fetch(CONFIG.geojson.url);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    const geojson = await respuesta.json();
    const propiedad = CONFIG.geojson.propiedadZona;
    const claves = Object.keys(CONFIG.zonas);

    const valores = claves.map(clave => {
      const datos = estado.datos[clave];
      return datos && datos.stats ? datos.stats.senPorDecada : null;
    });

    const traza = {
      type: 'choropleth',
      geojson,
      featureidkey: `properties.${propiedad}`,
      locations: claves,
      z: valores,
      text: claves.map(clave => CONFIG.zonas[clave].nombre),
      hovertemplate: '<b>%{text}</b><br>Sen: %{z:.1f} mm/década<extra></extra>',
      colorscale: [[0, '#f97316'], [0.5, '#1e293b'], [1, '#38bdf8']],
      zmid: 0,
      marker: { line: { color: 'rgba(230,237,255,0.6)', width: 1 } },
      colorbar: { thickness: 8, len: 0.6, tickfont: { color: '#7f93ba', size: 10 }, outlinewidth: 0 }
    };

    const layout = {
      geo: { fitbounds: 'locations', visible: false, bgcolor: 'rgba(0,0,0,0)' },
      paper_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 0, r: 0, t: 0, b: 0 },
      font: { family: 'Inter, sans-serif', color: '#b8c6e6' }
    };

    const contenedor = $('#mapa-geo');
    contenedor.hidden = false;
    $('#mapa-esquema').hidden = true;
    $('.map-note').textContent = 'Color: pendiente de Sen (mm/década)';

    await Plotly.newPlot(contenedor, [traza], layout, { displayModeBar: false, responsive: true });
    contenedor.on('plotly_click', evento => {
      const punto = evento.points && evento.points[0];
      if (punto && punto.location) seleccionarZona(punto.location);
    });
  } catch (error) {
    console.error('[geojson] No se pudo cargar el mapa:', error);
  }
}

function resaltarZonaGeoJSON() {
  const contenedor = $('#mapa-geo');
  if (!CONFIG.geojson.url || contenedor.hidden || typeof Plotly === 'undefined') return;
  const claves = Object.keys(CONFIG.zonas);
  const anchos = claves.map(clave => (clave === estado.zonaActiva ? 3 : 0.6));
  Plotly.restyle(contenedor, { 'marker.line.width': [anchos] });
}

/* ==========================================================================
   10. DASHBOARD DE MÉTRICAS
   ========================================================================== */
function actualizarDashboard() {
  const clave = estado.zonaActiva;
  const zona = CONFIG.zonas[clave];
  const datos = estado.datos[clave];

  document.documentElement.style.setProperty('--zona-color', zona.color);
  $('#zona-titulo').textContent = zona.nombre;
  $('#zona-titulo').style.color = zona.color;

  const chip = $('#trend-chip');
  chip.classList.remove('is-up', 'is-down', 'is-flat');

  const subtitulos = ['#m-sen-sub', '#m-mk-sub', '#m-cambio-sub'];
  subtitulos.forEach(id => $(id).classList.remove('is-up', 'is-down', 'is-sig'));

  // Zona sin datos
  if (!datos || !datos.stats) {
    $('#zona-descripcion').textContent = datos && datos.error ? `Error de datos: ${datos.error}` : zona.descripcion;
    ['#m-media', '#m-sen', '#m-mk', '#m-tendencia', '#m-cambio', '#m-max', '#m-min'].forEach(id => {
      $(id).textContent = '—';
      $(id).dataset.valor = '';
    });
    chip.classList.add('is-flat');
    $('#trend-chip-icon').textContent = '!';
    $('#trend-chip-texto').textContent = 'Sin datos';
    actualizarBarraEstado(null);
    return;
  }

  const s = datos.stats;
  $('#zona-descripcion').textContent = zona.descripcion;

  // Media
  animarNumero($('#m-media'), s.media, v => formatearNumero(v, 0));
  $('#m-media-sub').textContent = `${s.anioInicio} a ${s.anioFin} · σ = ${formatearNumero(s.desviacion, 0)} ${CONFIG.unidad}`;

  // Pendiente de Sen
  animarNumero($('#m-sen'), s.senPorDecada, v => formatearConSigno(v, 1));
  $('#m-sen-sub').textContent = s.senRelativoPct !== null
    ? `${formatearConSigno(s.senRelativoPct, 1)} % de la media por década`
    : 'Estimador robusto de tendencia';
  $('#m-sen-sub').classList.add(s.senPorDecada < 0 ? 'is-down' : 'is-up');

  // Mann-Kendall
  $('#m-mk').textContent = formatearPValor(s.mk.p);
  $('#m-mk').dataset.valor = String(s.mk.p);
  $('#m-mk-sub').textContent = s.mk.significativo
    ? `Significativa al ${CONFIG.alfa * 100} % · τ = ${formatearNumero(s.mk.tau, 2)}`
    : `No significativa al ${CONFIG.alfa * 100} % · τ = ${formatearNumero(s.mk.tau, 2)}`;
  if (s.mk.significativo) $('#m-mk-sub').classList.add('is-sig');

  // Tendencia lineal
  animarNumero($('#m-tendencia'), s.tendenciaPorDecada, v => formatearConSigno(v, 1));
  $('#m-tendencia-sub').textContent = `Mínimos cuadrados · R² = ${formatearNumero(s.regresion.r2, 2)}`;

  // Cambio decadal
  animarNumero($('#m-cambio'), s.cambioDecadalPct, v => formatearConSigno(v, 1));
  if (s.cambioDecadalPct !== null) {
    $('#m-cambio-sub').textContent =
      `${formatearNumero(s.mediaPrimera, 0)} → ${formatearNumero(s.mediaUltima, 0)} ${CONFIG.unidad}/año`;
    $('#m-cambio-sub').classList.add(s.cambioDecadalPct < 0 ? 'is-down' : 'is-up');
  } else {
    $('#m-cambio-sub').textContent = 'Se requieren al menos 20 años';
  }

  // Extremos
  $('#m-max').textContent = `${s.max.anio} · ${formatearNumero(s.max.valor, 0)} ${CONFIG.unidad}`;
  $('#m-min').textContent = `${s.min.anio} · ${formatearNumero(s.min.valor, 0)} ${CONFIG.unidad}`;

  // Chip de tendencia
  const tendencia = clasificarTendencia(s);
  chip.classList.add(tendencia.clase);
  $('#trend-chip-icon').textContent = tendencia.icono;
  $('#trend-chip-texto').textContent = tendencia.texto;

  // Destello en métricas
  $$('.metric__value').forEach(el => {
    el.classList.remove('value-flash');
    void el.offsetWidth;
    el.classList.add('value-flash');
  });

  actualizarBarraEstado(datos);
}

function actualizarBarraEstado(datos) {
  const zona = CONFIG.zonas[estado.zonaActiva];
  $('#estado-fuente').textContent = zona.archivo.split('/').pop();
  if (!datos || !datos.stats) {
    $('#estado-n').textContent = '—';
    $('#estado-columnas').textContent = 'no detectadas';
    return;
  }
  $('#estado-n').textContent = `${datos.stats.n} años`;
  $('#estado-columnas').textContent = `año = "${datos.columnas.nombreAnio}" · precipitación = "${datos.columnas.nombrePrecip}"`;
}

function actualizarHero() {
  let maxAnios = 0;
  let anioMin = Infinity;
  let anioMax = -Infinity;
  Object.values(estado.datos).forEach(datos => {
    if (!datos.stats) return;
    maxAnios = Math.max(maxAnios, datos.stats.n);
    anioMin = Math.min(anioMin, datos.stats.anioInicio);
    anioMax = Math.max(anioMax, datos.stats.anioFin);
  });
  if (maxAnios > 0) {
    $('#hero-anios').textContent = maxAnios;
    $('#hero-periodo').textContent = `${anioMin} a ${anioMax}`;
  }
}

/* ==========================================================================
   11. GRÁFICO TEMPORAL (PLOTLY)
   ========================================================================== */
function iniciarControlesGrafico() {
  $$('.segmented__btn').forEach(boton => {
    boton.addEventListener('click', () => {
      estado.vista = boton.dataset.vista;
      $$('.segmented__btn').forEach(b => b.classList.toggle('is-active', b === boton));
      actualizarGrafico();
    });
  });

  $('#toggle-tendencia').addEventListener('change', evento => {
    estado.mostrarTendencia = evento.target.checked;
    actualizarGrafico();
  });

  $('#toggle-media-movil').addEventListener('change', evento => {
    estado.mostrarMediaMovil = evento.target.checked;
    actualizarGrafico();
  });

  $('#toggle-comparar').addEventListener('change', evento => {
    estado.compararZonas = evento.target.checked;
    actualizarGrafico();
  });
}

function mostrarMensajeGrafico(titulo, detalle) {
  const contenedor = $('.chart-wrap');
  let mensaje = $('.chart-message', contenedor);
  if (!mensaje) {
    mensaje = document.createElement('div');
    mensaje.className = 'chart-message';
    contenedor.appendChild(mensaje);
  }
  mensaje.innerHTML = `<strong>${titulo}</strong><p>${detalle}</p>`;
  $('#grafico').style.visibility = 'hidden';
  $('#grafico-loader').classList.add('is-hidden');
}

function ocultarMensajeGrafico() {
  const mensaje = $('.chart-wrap .chart-message');
  if (mensaje) mensaje.remove();
  $('#grafico').style.visibility = 'visible';
}

/** Trazas para una sola zona. */
function construirTrazasZona(clave) {
  const zona = CONFIG.zonas[clave];
  const { anios, valores, stats } = estado.datos[clave];
  const trazas = [];

  if (estado.vista === 'anomalias') {
    const colores = stats.anomalias.map(v => (v >= 0 ? 'rgba(56, 189, 248, 0.85)' : 'rgba(249, 115, 22, 0.85)'));
    trazas.push({
      type: 'bar',
      x: anios,
      y: stats.anomalias,
      name: 'Anomalía',
      marker: { color: colores, line: { width: 0 } },
      customdata: stats.anomaliasPct,
      hovertemplate: `%{y:+.1f} ${CONFIG.unidad} (%{customdata:+.1f} %)<extra>Anomalía</extra>`
    });
  } else {
    trazas.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: anios,
      y: valores,
      name: `Precipitación ${zona.nombre}`,
      line: { color: zona.color, width: 2.2, shape: 'spline', smoothing: 0.6 },
      marker: { size: 5, color: zona.color, line: { color: '#02040b', width: 1 } },
      fill: 'tozeroy',
      fillcolor: hexARgba(zona.color, 0.08),
      hovertemplate: `%{y:.1f} ${CONFIG.unidad}<extra>${zona.nombre}</extra>`
    });
  }

  if (estado.mostrarMediaMovil) {
    const serieMovil = estado.vista === 'anomalias'
      ? stats.mediaMovil.map(v => (v === null ? null : v - stats.media))
      : stats.mediaMovil;
    trazas.push({
      type: 'scatter',
      mode: 'lines',
      x: anios,
      y: serieMovil,
      name: `Media móvil ${CONFIG.ventanaMediaMovil} años`,
      line: { color: '#e6edff', width: 2.4 },
      connectgaps: false,
      hovertemplate: `%{y:.1f} ${CONFIG.unidad}<extra>Media móvil</extra>`
    });
  }

  if (estado.mostrarTendencia) {
    const desplazamiento = estado.vista === 'anomalias' ? stats.media : 0;
    const lineaSen = [];
    for (let i = 0; i < anios.length; i++) {
      lineaSen.push(stats.sen.intercepto + stats.sen.pendiente * anios[i] - desplazamiento);
    }
    trazas.push({
      type: 'scatter',
      mode: 'lines',
      x: anios,
      y: lineaSen,
      name: `Tendencia Sen (${formatearConSigno(stats.senPorDecada, 1)} ${CONFIG.unidad}/déc)`,
      line: { color: '#fc3d21', width: 2, dash: 'dash' },
      hovertemplate: `%{y:.1f} ${CONFIG.unidad}<extra>Tendencia</extra>`
    });
  }

  return trazas;
}

/** Trazas para comparar las tres zonas. En anomalías se usa % para hacerlas comparables. */
function construirTrazasComparacion() {
  const trazas = [];
  Object.keys(CONFIG.zonas).forEach(clave => {
    const datos = estado.datos[clave];
    if (!datos || !datos.stats) return;
    const zona = CONFIG.zonas[clave];
    const esActiva = clave === estado.zonaActiva;
    const enPorcentaje = estado.vista === 'anomalias';
    const y = enPorcentaje ? datos.stats.anomaliasPct : datos.valores;

    trazas.push({
      type: 'scatter',
      mode: 'lines',
      x: datos.anios,
      y,
      name: zona.nombre,
      line: { color: zona.color, width: esActiva ? 3 : 1.6, shape: 'spline', smoothing: 0.5 },
      opacity: esActiva ? 1 : 0.65,
      hovertemplate: enPorcentaje
        ? `%{y:+.1f} %<extra>${zona.nombre}</extra>`
        : `%{y:.1f} ${CONFIG.unidad}<extra>${zona.nombre}</extra>`
    });

    if (estado.mostrarTendencia) {
      const linea = [];
      for (let i = 0; i < datos.anios.length; i++) {
        const valorSen = datos.stats.sen.intercepto + datos.stats.sen.pendiente * datos.anios[i];
        linea.push(enPorcentaje ? (valorSen - datos.stats.media) / datos.stats.media * 100 : valorSen);
      }
      trazas.push({
        type: 'scatter',
        mode: 'lines',
        x: datos.anios,
        y: linea,
        name: `Tendencia ${zona.nombre}`,
        showlegend: false,
        line: { color: zona.color, width: 1.5, dash: 'dash' },
        hoverinfo: 'skip'
      });
    }
  });
  return trazas;
}

function actualizarGrafico() {
  const contenedor = $('#grafico');
  if (!contenedor) return;

  if (typeof Plotly === 'undefined') {
    mostrarMensajeGrafico('Plotly no está disponible', 'Revisa la conexión a internet: la librería se carga desde cdn.plot.ly.');
    return;
  }

  const clave = estado.zonaActiva;
  const zona = CONFIG.zonas[clave];
  const datos = estado.datos[clave];
  const hayAlgunDato = Object.values(estado.datos).some(d => d && d.stats);

  if (!estado.compararZonas && (!datos || !datos.stats)) {
    mostrarMensajeGrafico(
      `No se pudieron cargar los datos de ${zona.nombre}`,
      `${datos && datos.error ? datos.error : 'Archivo no disponible.'}<br><code>${zona.archivo}</code>`
    );
    return;
  }
  if (estado.compararZonas && !hayAlgunDato) {
    mostrarMensajeGrafico('Sin datos para comparar', 'Ningún archivo CSV pudo ser cargado.');
    return;
  }

  ocultarMensajeGrafico();

  const trazas = estado.compararZonas ? construirTrazasComparacion() : construirTrazasZona(clave);

  let tituloEjeY = `Precipitación (${CONFIG.unidad}/año)`;
  let tituloGrafico = `Precipitación anual · ${zona.nombre}`;
  if (estado.vista === 'anomalias') {
    tituloEjeY = estado.compararZonas ? 'Anomalía (% de la media)' : `Anomalía (${CONFIG.unidad})`;
    tituloGrafico = estado.compararZonas ? 'Anomalías relativas · todas las zonas' : `Anomalías respecto de la media · ${zona.nombre}`;
  } else if (estado.compararZonas) {
    tituloGrafico = 'Precipitación anual · todas las zonas';
  }
  $('#grafico-titulo').textContent = tituloGrafico;

  const colorGrilla = 'rgba(120, 160, 255, 0.08)';
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#b8c6e6', size: 12 },
    margin: { l: 64, r: 18, t: 12, b: 40 },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#0b1630',
      bordercolor: '#3b82f6',
      font: { family: 'Inter, sans-serif', color: '#e6edff', size: 12 }
    },
    bargap: 0.18,
    showlegend: true,
    legend: {
      orientation: 'h',
      x: 0,
      y: 1.1,
      font: { size: 11.5 },
      bgcolor: 'rgba(0,0,0,0)'
    },
    xaxis: {
      gridcolor: colorGrilla,
      linecolor: 'rgba(120, 160, 255, 0.2)',
      zeroline: false,
      tickfont: { family: 'JetBrains Mono, monospace', size: 11 },
      rangeslider: {
        visible: true,
        thickness: 0.08,
        bgcolor: 'rgba(10, 20, 48, 0.6)',
        bordercolor: 'rgba(120, 160, 255, 0.2)',
        borderwidth: 1
      }
    },
    yaxis: {
      title: { text: tituloEjeY, font: { size: 12, color: '#7f93ba' } },
      gridcolor: colorGrilla,
      zeroline: estado.vista === 'anomalias',
      zerolinecolor: 'rgba(230, 237, 255, 0.35)',
      zerolinewidth: 1,
      tickfont: { family: 'JetBrains Mono, monospace', size: 11 },
      rangemode: estado.vista === 'anomalias' ? 'normal' : 'tozero'
    },
    transition: { duration: prefiereMenosMovimiento ? 0 : 500, easing: 'cubic-in-out' }
  };

  const configuracion = {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d', 'toggleSpikelines'],
    toImageButtonOptions: { format: 'png', filename: `precipitacion_${clave}`, scale: 2 }
  };

  Plotly.react(contenedor, trazas, layout, configuracion);
  estado.graficoIniciado = true;
  $('#grafico-loader').classList.add('is-hidden');
}

/* ==========================================================================
   12. HALLAZGOS GENERADOS A PARTIR DE LOS DATOS
   ========================================================================== */
function generarHallazgos() {
  const grilla = $('#hallazgos-grid');
  const claves = Object.keys(CONFIG.zonas);
  const tarjetas = [];
  const conDatos = [];

  claves.forEach(clave => {
    const zona = CONFIG.zonas[clave];
    const datos = estado.datos[clave];

    if (!datos || !datos.stats) {
      tarjetas.push(`
        <article class="finding" style="--zona-color:${zona.color}">
          <span class="finding__zone">${zona.nombre}</span>
          <p class="finding__text" style="margin-top:14px">No fue posible calcular hallazgos: ${datos && datos.error ? datos.error : 'archivo no disponible'}.</p>
        </article>`);
      return;
    }

    const s = datos.stats;
    conDatos.push({ clave, zona, s });

    const direccion = s.senPorDecada < 0 ? 'disminución' : 'aumento';
    const significancia = s.mk.significativo
      ? `estadísticamente significativa (Mann-Kendall, p = ${formatearPValor(s.mk.p)})`
      : `no significativa al ${CONFIG.alfa * 100} % (Mann-Kendall, p = ${formatearPValor(s.mk.p)})`;

    let fraseDecadas = '';
    if (s.cambioDecadalPct !== null) {
      const comparacion = s.cambioDecadalPct < 0 ? 'más seca' : 'más lluviosa';
      fraseDecadas = ` La última década fue <strong>${formatearNumero(Math.abs(s.cambioDecadalPct), 1)} % ${comparacion}</strong> que la primera.`;
    }

    tarjetas.push(`
      <article class="finding reveal" style="--zona-color:${zona.color}">
        <span class="finding__zone">${zona.nombre}</span>
        <div class="finding__big">${formatearConSigno(s.senPorDecada, 1)}<small>${CONFIG.unidad}/década</small></div>
        <span class="finding__badge ${s.mk.significativo ? 'is-sig' : ''}">
          ${s.mk.significativo ? 'SEÑAL SIGNIFICATIVA' : 'SEÑAL NO SIGNIFICATIVA'}
        </span>
        <p class="finding__text">
          Entre ${s.anioInicio} y ${s.anioFin} la precipitación media fue de
          <strong>${formatearNumero(s.media, 0)} ${CONFIG.unidad}/año</strong>. La pendiente de Sen indica una
          ${direccion} de <strong>${formatearNumero(Math.abs(s.senRelativoPct), 1)} % de la media por década</strong>,
          ${significancia}.${fraseDecadas}
        </p>
      </article>`);
  });

  // Tarjeta comparativa
  if (conDatos.length >= 2) {
    let mayorBaja = null;
    let mayorAlza = null;
    let significativas = 0;
    for (let i = 0; i < conDatos.length; i++) {
      const item = conDatos[i];
      if (item.s.mk.significativo) significativas++;
      if (mayorBaja === null || item.s.senRelativoPct < mayorBaja.s.senRelativoPct) mayorBaja = item;
      if (mayorAlza === null || item.s.senRelativoPct > mayorAlza.s.senRelativoPct) mayorAlza = item;
    }

    let texto = '';
    if (mayorBaja.s.senRelativoPct < 0) {
      texto += `La zona <strong>${mayorBaja.zona.nombre}</strong> presenta la mayor disminución relativa
        (${formatearConSigno(mayorBaja.s.senRelativoPct, 1)} % de su media por década). `;
    }
    if (mayorAlza.s.senRelativoPct > 0) {
      texto += `La zona <strong>${mayorAlza.zona.nombre}</strong> presenta el mayor aumento relativo
        (${formatearConSigno(mayorAlza.s.senRelativoPct, 1)} % de su media por década). `;
    }
    texto += `${significativas} de ${conDatos.length} zonas muestran una tendencia estadísticamente significativa al ${CONFIG.alfa * 100} %.`;

    tarjetas.push(`
      <article class="finding finding--wide reveal">
        <span class="finding__zone" style="color:#e6edff">Comparación entre zonas</span>
        <p class="finding__text" style="margin-top:14px; font-size:1.02rem">${texto}</p>
      </article>`);
  }

  grilla.innerHTML = tarjetas.join('');

  // Activar animación de aparición en las tarjetas nuevas
  const observador = new IntersectionObserver(entradas => {
    entradas.forEach(entrada => {
      if (entrada.isIntersecting) {
        entrada.target.classList.add('is-visible');
        observador.unobserve(entrada.target);
      }
    });
  }, { threshold: 0.12 });
  $$('.reveal', grilla).forEach((el, i) => {
    el.style.setProperty('--reveal-delay', `${Math.min(i * 0.08, 0.4)}s`);
    observador.observe(el);
  });
}

/** Mensaje global cuando ningún CSV pudo cargarse (por ejemplo, al abrir con file://). */
function mostrarErrorGlobalDatos() {
  const esArchivoLocal = window.location.protocol === 'file:';
  const detalle = esArchivoLocal
    ? 'El navegador bloquea la lectura de CSV al abrir el sitio con file://. Usa un servidor local o GitHub Pages.'
    : 'Verifica que los archivos existan en la carpeta data/ con los nombres configurados.';
  $('#hallazgos-grid').innerHTML = `
    <div class="finding finding--error">
      <p class="mono">No se pudieron cargar los datos</p>
      <p>${detalle}</p>
    </div>`;
}

/* ==========================================================================
   13. INICIO
   ========================================================================== */
async function iniciar() {
  iniciarNavegacion();
  iniciarStarfield();
  iniciarReveal();
  iniciarSelectores();
  iniciarControlesGrafico();

  // Estado visual inicial del selector y del mapa
  seleccionarZonaVisual(estado.zonaActiva);

  await cargarTodosLosDatos();

  const hayAlgunDato = Object.values(estado.datos).some(d => d && d.stats);
  if (!hayAlgunDato) mostrarErrorGlobalDatos();
  else generarHallazgos();

  actualizarHero();
  actualizarEtiquetasMapa();
  seleccionarZona(estado.zonaActiva);
  inicializarMapaGeoJSON();
}

/** Marca la zona inicial sin calcular nada (antes de cargar datos). */
function seleccionarZonaVisual(clave) {
  $$('.zona-shape').forEach(forma => forma.classList.toggle('is-active', forma.dataset.zona === clave));
  $$('.zona-label').forEach((etiqueta, i) => {
    etiqueta.classList.toggle('is-active', Object.keys(CONFIG.zonas)[i] === clave);
  });
}

document.addEventListener('DOMContentLoaded', iniciar);