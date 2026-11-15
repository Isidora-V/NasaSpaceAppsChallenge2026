// Este archivo es un script que controla la interfaz de usuario en la web.
'use strict';

const CONFIG = {
  fuentes: {
    satelite: { nombre: 'el satélite GPM IMERG de la NASA', etiqueta: 'Satélite NASA' },
    historico: { nombre: 'el registro histórico', etiqueta: 'Registro histórico' }
  },
  zonas: {
    norte: {
      nombre: 'Zona Norte',
      latitudes: '18° a 31° S',
      color: '#c2652a',
      descripcion: 'Desierto de Atacama y Altiplano. Casi toda la lluvia cae en verano, durante el invierno altiplánico, y cambia muchísimo de un año a otro.',
      archivos: {
        satelite: '../backend/data/NASA/clean/norte_precipitacion_anual.csv',
        historico: '../backend/data/NO_NASA/clean/norte_precipitacion_anual.csv'
      }
    },
    centro: {
      nombre: 'Zona Centro',
      latitudes: '31° a 38° S',
      color: '#2c6e8f',
      descripcion: 'Clima mediterráneo, con lluvias concentradas en invierno. Aquí vive la mayor parte de la población y es donde más se ha sentido la megasequía desde 2010.',
      archivos: {
        satelite: '../backend/data/NASA/clean/centro_precipitacion_anual.csv',
        historico: '../backend/data/NO_NASA/clean/centro_precipitacion_anual.csv'
      }
    },
    sur: {
      nombre: 'Zona Sur',
      latitudes: '39° a 53° S',
      color: '#3f7a4c',
      descripcion: 'Clima templado y lluvioso. Es la zona más húmeda del país, así que incluso cambios grandes en milímetros pesan poco en porcentaje.',
      archivos: {
        satelite: '../backend/data/NASA/clean/sur_precipitacion_anual.csv',
        historico: '../backend/data/NO_NASA/clean/sur_precipitacion_anual.csv'
      }
    }
  },
  zonaInicial: 'centro',
  fuenteInicial: 'satelite',
  ventanaMediaMovil: 5,
  alfa: 0.05,
  zCritico: 1.959964,   // cuantil 0,975 de la normal estándar
  anioMaximo: 2025,
  colorAnomaliaPositiva: '#2c6e8f',
  colorAnomaliaNegativa: '#c2652a',
  colorOtraFuente: '#9a9384'
};

const estado = {
  zonaActiva: CONFIG.zonaInicial,
  fuente: CONFIG.fuenteInicial,
  datos: {},
  vista: 'serie',
  mostrarTendencia: true,
  mostrarMediaMovil: true,
  compararFuentes: false
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// Formato

function formatearNumero(v, dec = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toLocaleString('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function formatearConSigno(v, dec = 1) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return (v > 0 ? '+' : '') + formatearNumero(v, dec);
}

function formatearPValor(p) {
  if (p === null || Number.isNaN(p)) return '—';
  if (p < 0.001) return '< 0,001';
  if (p < 0.01) return formatearNumero(p, 3);
  return formatearNumero(p, 2);
}

// Estadística

function mediana(lista) {
  const ordenada = lista.slice().sort((a, b) => a - b);
  const m = Math.floor(ordenada.length / 2);
  if (ordenada.length % 2 === 0) return (ordenada[m - 1] + ordenada[m]) / 2;
  return ordenada[m];
}

function rangos(lista) {
  const indices = [];
  for (let i = 0; i < lista.length; i++) indices.push(i);
  indices.sort((a, b) => lista[a] - lista[b]);

  const r = new Array(lista.length);
  let i = 0;
  while (i < indices.length) {
    let j = i;
    while (j + 1 < indices.length && lista[indices[j + 1]] === lista[indices[i]]) j++;
    const rangoPromedio = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[indices[k]] = rangoPromedio;
    i = j + 1;
  }
  return r;
}

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

function normalCDF(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

function erf(x) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - p * Math.exp(-a * a));
}

function pValorMK(S, varianza) {
  let Z = 0;
  if (S > 0) Z = (S - 1) / Math.sqrt(varianza);
  if (S < 0) Z = (S + 1) / Math.sqrt(varianza);
  return 2 * (1 - normalCDF(Math.abs(Z)));
}

// Corrección de Hamed y Rao infla la varianza de S según la autocorrelación
// significativa de los rangos de la serie sin tendencia.
function factorHamedRao(anios, valores, pendienteSen) {
  const n = valores.length;

  const sinTendencia = [];
  for (let i = 0; i < n; i++) sinTendencia.push(valores[i] - pendienteSen * anios[i]);
  const R = rangos(sinTendencia);

  let r_promedio = 0;
  for (let i = 0; i < n; i++) r_promedio += R[i];
  r_promedio /= n;

  let c0 = 0;
  for (let i = 0; i < n; i++) c0 += (R[i] - r_promedio) ** 2;

  const limite = CONFIG.zCritico / Math.sqrt(n);
  let suma = 0;
  for (let k = 1; k < n; k++) {
    let ck = 0;
    for (let i = 0; i < n - k; i++) ck += (R[i] - r_promedio) * (R[i + k] - r_promedio);
    const rho_k = ck / c0;
    if (Math.abs(rho_k) > limite) suma += (n - k) * (n - k - 1) * (n - k - 2) * rho_k;
  }

  const factor = 1 + (2 / (n * (n - 1) * (n - 2))) * suma;
  return factor > 0 ? factor : 1;
}

function calcularEstadisticas(anios, valores) {
  const n = valores.length;

  let suma = 0;
  for (let i = 0; i < n; i++) suma += valores[i];
  const media = suma / n;

  // Pendiente de Sen
  const pendientes = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      pendientes.push((valores[j] - valores[i]) / (anios[j] - anios[i]));
    }
  }
  const pendienteSen = mediana(pendientes);

  const residuos = [];
  for (let i = 0; i < n; i++) residuos.push(valores[i] - pendienteSen * anios[i]);
  const interceptoSen = mediana(residuos);

  // Mann-Kendall
  let S = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      S += Math.sign(valores[j] - valores[i]);
    }
  }
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const factor = factorHamedRao(anios, valores, pendienteSen);
  const pClasico = pValorMK(S, varS);
  const pCorregido = pValorMK(S, varS * factor);

  const anomalias = [];
  const lineaSen = [];
  for (let i = 0; i < n; i++) {
    anomalias.push(valores[i] - media);
    lineaSen.push(interceptoSen + pendienteSen * anios[i]);
  }

  const tendenciaInicio = lineaSen[0];
  const tendenciaFin = lineaSen[n - 1];
  const cambioPorcentual = tendenciaInicio > 0 ? ((tendenciaFin - tendenciaInicio) / tendenciaInicio) * 100 : null;

  return {
    n, media,
    senPorDecada: pendienteSen * 10,
    tendenciaInicio, tendenciaFin, cambioPorcentual,
    mk: { S, pClasico, pCorregido, factor, significativo: pCorregido < CONFIG.alfa },
    anomalias, lineaSen,
    mediaMovil: mediaMovilCentrada(valores, CONFIG.ventanaMediaMovil),
    anioInicio: anios[0],
    anioFin: anios[n - 1]
  };
}

// Datos

function parsearCSV(texto) {
  const lineas = texto.replace(/\r\n?/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (lineas.length < 2) throw new Error('CSV vacío');
  const delimitador = lineas[0].includes(';') ? ';' : ',';
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    filas.push(lineas[i].split(delimitador).map(c => c.trim().replace(/"/g, '')));
  }
  return filas;
}

// Ambas fuentes vienen en mm/año: columna 0 = año, columna 1 = precipitación anual
function construirSerie(filas) {
  const pares = [];
  for (const fila of filas) {
    const anio = Number(fila[0]);
    const mm = Number(fila[1]);
    if (Number.isNaN(anio) || Number.isNaN(mm)) continue;
    if (anio > CONFIG.anioMaximo) continue;
    pares.push({ anio, mm });
  }
  pares.sort((a, b) => a.anio - b.anio);

  const anios = [];
  const valores = [];
  for (const par of pares) {
    anios.push(par.anio);
    valores.push(par.mm);
  }
  return { anios, valores };
}

async function cargarSerie(ruta) {
  const res = await fetch(ruta);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { anios, valores } = construirSerie(parsearCSV(await res.text()));
  if (anios.length < 10) throw new Error('Serie demasiado corta');
  return { anios, valores, stats: calcularEstadisticas(anios, valores) };
}

async function cargarTodos() {
  const tareas = [];
  const destinos = [];
  for (const clave of Object.keys(CONFIG.zonas)) {
    estado.datos[clave] = {};
    for (const fuente of Object.keys(CONFIG.fuentes)) {
      tareas.push(cargarSerie(CONFIG.zonas[clave].archivos[fuente]));
      destinos.push([clave, fuente]);
    }
  }
  const resultados = await Promise.allSettled(tareas);
  for (let i = 0; i < resultados.length; i++) {
    const [clave, fuente] = destinos[i];
    const r = resultados[i];
    estado.datos[clave][fuente] = r.status === 'fulfilled' ? r.value : { error: r.reason.message };
  }
}

function datosDe(clave, fuente) {
  const zona = estado.datos[clave];
  if (!zona) return null;
  return zona[fuente] || null;
}

function otraFuente(fuente) {
  return fuente === 'satelite' ? 'historico' : 'satelite';
}

// Interfaz

function seleccionarZona(clave) {
  estado.zonaActiva = clave;
  $('#mapa').dataset.activa = clave;

  for (const boton of $$('.franja')) {
    const activa = boton.dataset.zona === clave;
    boton.classList.toggle('is-activa', activa);
    boton.setAttribute('aria-pressed', activa ? 'true' : 'false');
  }

  document.documentElement.style.setProperty('--zona', `var(--${clave})`);
  actualizarTodo();
}

function seleccionarFuente(fuente) {
  estado.fuente = fuente;
  for (const boton of $$('.fuente')) {
    boton.classList.toggle('is-activa', boton.dataset.fuente === fuente);
  }
  actualizarTodo();
}

function actualizarTodo() {
  actualizarPanel();
  actualizarGrafico();
  actualizarContexto();
}

function construirLectura(zona, fuente, s) {
  const direccion = s.senPorDecada < 0 ? 'baja' : 'sube';
  let texto = `Según ${fuente.nombre}, entre ${s.anioInicio} y ${s.anioFin} cayeron en promedio ${formatearNumero(s.media, 0)} mm de lluvia al año en la ${zona.nombre}. ` +
              `La tendencia ${direccion} unos ${formatearNumero(Math.abs(s.senPorDecada), 0)} mm por década: ` +
              `pasa de cerca de ${formatearNumero(s.tendenciaInicio, 0)} mm a ${formatearNumero(s.tendenciaFin, 0)} mm al año. `;

  if (s.mk.significativo) {
    texto += `El test de Mann-Kendall indica que es poco probable que este cambio sea solo azar (p = ${formatearPValor(s.mk.pCorregido)}).`;
  } else {
    texto += `Aun así, la lluvia varía tanto de un año a otro que, con ${s.n} años de datos, el test de Mann-Kendall no permite descartar que sea variación natural (p = ${formatearPValor(s.mk.pCorregido)}).`;
  }

  if (s.mk.factor > 1.05) {
    texto += ` Como los años secos tienden a venir seguidos, corregimos el test por autocorrelación (sin corregir, p sería ${formatearPValor(s.mk.pClasico)}).`;
  }
  return texto;
}

function actualizarPanel() {
  const zona = CONFIG.zonas[estado.zonaActiva];
  const fuente = CONFIG.fuentes[estado.fuente];
  const datos = datosDe(estado.zonaActiva, estado.fuente);

  $('#zona-lat').textContent = `Macrozona, ${zona.latitudes}`;
  $('#zona-titulo').textContent = zona.nombre;
  $('#zona-desc').textContent = zona.descripcion;

  if (!datos || datos.error) {
    for (const id of ['#m-media', '#m-sen', '#m-cambio', '#m-mk']) $(id).textContent = '—';
    $('#lectura').textContent = 'No pudimos cargar estos datos. Abre el sitio con Live Server desde la carpeta raíz del repositorio y revisa que el CSV exista.';
    $('#grafico-titulo').textContent = 'Lluvia anual';
    return;
  }

  const s = datos.stats;
  $('#m-media').textContent = formatearNumero(s.media, 0);
  $('#m-sen').textContent = formatearConSigno(s.senPorDecada, 0);
  $('#m-cambio').textContent = s.cambioPorcentual === null ? '—' : `${formatearConSigno(s.cambioPorcentual, 0)}%`;
  $('#m-mk').textContent = `p = ${formatearPValor(s.mk.pCorregido)}`;
  $('#m-mk-texto').textContent = s.mk.significativo
    ? 'tendencia significativa (Mann-Kendall corregido, 5%)'
    : 'no significativa (Mann-Kendall corregido, 5%)';
  $('#lectura').textContent = construirLectura(zona, fuente, s);
  $('#grafico-titulo').textContent = `${fuente.etiqueta}, ${s.anioInicio}–${s.anioFin}`;
}

function actualizarGrafico() {
  const contenedor = $('#grafico');
  const cargador = $('#grafico-loader');
  const datos = datosDe(estado.zonaActiva, estado.fuente);
  const esAnomalias = estado.vista === 'anomalias';
  const c = coloresTema();
  const colorZona = c[estado.zonaActiva];

  $('.opciones-grafico').hidden = esAnomalias;

  if (!datos || datos.error) {
    cargador.textContent = 'No hay datos disponibles para esta zona y fuente.';
    cargador.classList.remove('is-oculto');
    Plotly.purge(contenedor);
    return;
  }

  const s = datos.stats;
  const trazas = [];

  if (esAnomalias) {
    const colores = [];
    for (const v of s.anomalias) colores.push(v >= 0 ? c.centro : c.norte);
    trazas.push({
      type: 'bar',
      x: datos.anios,
      y: s.anomalias,
      marker: { color: colores },
      name: 'Diferencia con el promedio',
      hovertemplate: '%{x}: %{y:+,.0f} mm<extra></extra>'
    });
  } else {
    if (estado.compararFuentes) {
      const claveOtra = otraFuente(estado.fuente);
      const otra = datosDe(estado.zonaActiva, claveOtra);
      if (otra && !otra.error) {
        trazas.push({
          type: 'scatter', mode: 'lines',
          x: otra.anios, y: otra.valores,
          line: { color: c.otraFuente, width: 1.5 },
          name: CONFIG.fuentes[claveOtra].etiqueta,
          hovertemplate: '%{x}: %{y:,.0f} mm<extra></extra>'
        });
      }
    }

    trazas.push({
      type: 'scatter',
      mode: 'lines+markers',
      x: datos.anios,
      y: datos.valores,
      line: { color: colorZona, width: 2 },
      marker: { size: 5, color: colorZona },
      name: CONFIG.fuentes[estado.fuente].etiqueta,
      hovertemplate: '%{x}: %{y:,.0f} mm<extra></extra>'
    });

    if (estado.mostrarMediaMovil) {
      trazas.push({
        type: 'scatter', mode: 'lines',
        x: datos.anios, y: s.mediaMovil,
        line: { color: c.tinta, width: 1.5 },
        name: 'Media móvil 5 años', hoverinfo: 'skip'
      });
    }
    if (estado.mostrarTendencia) {
      trazas.push({
        type: 'scatter', mode: 'lines',
        x: datos.anios, y: s.lineaSen,
        line: { color: c.tinta, width: 1.5, dash: 'dash' },
        name: 'Tendencia (Sen)', hoverinfo: 'skip'
      });
    }
  }

  const layout = Object.assign(layoutBase(c), {
    margin: { l: 56, r: 8, t: 36, b: 32 },
    xaxis: { showgrid: false, zeroline: false, linecolor: c.linea, ticks: 'outside', tickcolor: c.linea, dtick: 5 },
    yaxis: {
      gridcolor: c.linea,
      zeroline: esAnomalias, zerolinecolor: c.tinta,
      rangemode: esAnomalias ? 'normal' : 'tozero',
      title: { text: esAnomalias ? 'mm sobre o bajo el promedio' : 'mm al año', font: { size: 11 } }
    },
    showlegend: !esAnomalias,
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 11, color: c.tinta } },
    bargap: 0.25
  });

  Plotly.react(contenedor, trazas, layout, { responsive: true, displayModeBar: false });
  cargador.classList.add('is-oculto');
}

// Claro / oscuro

const CLAVE_TEMA = 'lluvia-chile-tema';

function leerVariable(nombre) {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

function coloresTema() {
  return {
    tinta: leerVariable('--tinta'),
    suave: leerVariable('--tinta-suave'),
    linea: leerVariable('--linea-grafico'),
    papel: leerVariable('--papel'),
    papel2: leerVariable('--papel-2'),
    otraFuente: leerVariable('--otra-fuente'),
    norte: leerVariable('--norte'),
    centro: leerVariable('--centro'),
    sur: leerVariable('--sur')
  };
}

function layoutBase(c) {
  return {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    separators: ',.',
    font: { family: 'IBM Plex Sans, sans-serif', size: 12, color: c.suave },
    hoverlabel: {
      bgcolor: c.papel,
      bordercolor: c.linea,
      font: { family: 'IBM Plex Sans, sans-serif', color: c.tinta }
    }
  };
}

function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  const boton = $('#tema-toggle');
  if (!boton) return;
  const oscuro = tema === 'oscuro';
  boton.setAttribute('aria-pressed', oscuro ? 'true' : 'false');
  boton.setAttribute('aria-label', oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
  boton.querySelector('.tema-texto').textContent = oscuro ? 'Modo claro' : 'Modo oscuro';
}

function alternarTema() {
  const nuevo = document.documentElement.dataset.tema === 'oscuro' ? 'claro' : 'oscuro';
  aplicarTema(nuevo);
  try { localStorage.setItem(CLAVE_TEMA, nuevo); } catch (e) { /* almacenamiento no disponible */ }
  actualizarGrafico();
  actualizarContexto();
}

// Contexto: hitos, mapa de calor y comparación

const TIPOS_HITO = {
  clima: { etiqueta: 'Clima', simbolo: 'circle' },
  territorio: { etiqueta: 'Territorio', simbolo: 'triangle-up' },
  ley: { etiqueta: 'Ley', simbolo: 'square' }
};

const HITOS = [
  {
    anio: 1982, tipo: 'clima', titulo: 'El Niño 1982–83',
    texto: 'Uno de los eventos El Niño más intensos del siglo XX. En Chile central, El Niño suele asociarse a inviernos más lluviosos de lo normal.',
    cuidado: 'No todos los El Niño traen más lluvia, y no toda la lluvia extra de esos años se explica por El Niño.'
  },
  {
    anio: 1997, tipo: 'clima', titulo: 'El Niño 1997–98',
    texto: 'Otro El Niño muy intenso. 1997 fue un año especialmente lluvioso en la zona central.',
    cuidado: 'Un año muy lluvioso puede inclinar una tendencia. Por eso usamos la pendiente de Sen, que es resistente a años extremos.'
  },
  {
    anio: 1998, tipo: 'clima', titulo: 'La Niña 1998–2000',
    texto: 'Tras El Niño llegó La Niña, que en Chile central se asocia a inviernos más secos. 1998 fue un año muy seco.',
    cuidado: 'Pasar de un año muy húmedo a uno muy seco muestra cuánto varía la lluvia de un año a otro, independiente de cualquier tendencia.'
  },
  {
    anio: 2010, tipo: 'clima', titulo: 'Comienza la megasequía',
    texto: 'Desde 2010 la zona central encadena años con lluvias bajo lo normal. El CR2 la describe como una sequía sin precedentes por su duración y extensión.',
    cuidado: 'Estudios del CR2 atribuyen parte del déficit al cambio climático y parte a la variabilidad natural. Nuestros datos muestran el déficit, no su causa.'
  },
  {
    anio: 2015, tipo: 'clima', titulo: 'El Niño 2015–16',
    texto: 'Uno de los El Niño más intensos registrados. Aun así, no puso fin a la megasequía.',
    cuidado: 'Un mismo fenómeno no siempre tiene el mismo efecto: depende de cómo interactúa con otros factores del clima.'
  },
  {
    anio: 2017, tipo: 'territorio', titulo: 'Megaincendios de 2017',
    texto: 'Entre enero y febrero de 2017 se quemó una superficie récord en la zona centro-sur, con O’Higgins, Maule y Biobío entre las regiones más afectadas.',
    cuidado: 'La sequía reseca la vegetación y facilita el fuego, pero los incendios también dependen del calor, el viento, el tipo de plantaciones y la acción humana.'
  },
  {
    anio: 2019, tipo: 'clima', titulo: 'Un año extremadamente seco',
    texto: '2019 fue uno de los años más secos registrados en la zona central.',
    cuidado: 'Un año extremo cerca del final de la serie también pesa en la tendencia. Míralo junto a los años que lo rodean.'
  },
  {
    anio: 2022, tipo: 'ley', titulo: 'Reforma al Código de Aguas',
    texto: 'La Ley 21.435 reconoce el agua como bien nacional de uso público y prioriza el consumo humano y el saneamiento.',
    cuidado: 'Una ley no cambia la lluvia. Lo que podría cambiar es cómo se reparte el agua disponible, y eso no lo medimos aquí.'
  },
  {
    anio: 2022, tipo: 'ley', titulo: 'Ley Marco de Cambio Climático',
    texto: 'La Ley 21.455 fija la meta de carbono neutralidad para 2050 y exige planes de adaptación, incluidos los recursos hídricos.',
    cuidado: 'Sus efectos, si los hay, se verían en la gestión del agua y en varios años más, no en la lluvia de 2022.'
  },
  {
    anio: 2024, tipo: 'territorio', titulo: 'Incendios en la región de Valparaíso',
    texto: 'En febrero de 2024, incendios en Viña del Mar, Quilpué y Villa Alemana se convirtieron en uno de los desastres más mortíferos de la historia reciente de Chile.',
    cuidado: 'Aquí pesan mucho la expansión urbana hacia los cerros y la cercanía de viviendas a la vegetación, factores que no medimos en este sitio.'
  }
];

const contexto = { filtro: 'todos', hitoActivo: null };

function filtroAcepta(hito) {
  return contexto.filtro === 'todos' || hito.tipo === contexto.filtro;
}

function seleccionarHito(indice) {
  contexto.hitoActivo = contexto.hitoActivo === indice ? null : indice;
  renderizarHitos();
  renderizarDetalle();
  actualizarLineaTiempo();
}

function seleccionarFiltro(tipo) {
  contexto.filtro = tipo;
  for (const boton of $$('.hito-filtro')) boton.classList.toggle('is-activo', boton.dataset.tipo === tipo);
  if (contexto.hitoActivo !== null && !filtroAcepta(HITOS[contexto.hitoActivo])) contexto.hitoActivo = null;
  renderizarHitos();
  renderizarDetalle();
  actualizarLineaTiempo();
}

function renderizarHitos() {
  const lista = $('#hitos-lista');
  const datos = datosDe(estado.zonaActiva, estado.fuente);
  lista.innerHTML = '';

  for (let i = 0; i < HITOS.length; i++) {
    const hito = HITOS[i];
    if (!filtroAcepta(hito)) continue;

    const fuera = !datos || datos.error || hito.anio < datos.stats.anioInicio || hito.anio > datos.stats.anioFin;
    const item = document.createElement('li');
    const boton = document.createElement('button');
    boton.className = 'hito-boton';
    if (i === contexto.hitoActivo) boton.classList.add('is-activo');
    if (fuera) {
      boton.classList.add('is-fuera');
      boton.title = 'Este año no está en la fuente elegida';
    }
    boton.dataset.indice = i;
    boton.innerHTML =
      `<span class="hito-anio">${hito.anio}</span>` +
      `<span class="hito-titulo">${hito.titulo}</span>` +
      `<span class="hito-tipo"><span class="hito-simbolo simbolo-${hito.tipo}"></span>${TIPOS_HITO[hito.tipo].etiqueta}</span>`;
    item.appendChild(boton);
    lista.appendChild(item);
  }
}

function renderizarDetalle() {
  const caja = $('#hito-detalle');

  if (contexto.hitoActivo === null) {
    caja.innerHTML = '<p class="ctx-sub">Toca un hito de la lista o un símbolo del gráfico para ver de qué se trata y qué muestran los datos ese año.</p>';
    return;
  }

  const hito = HITOS[contexto.hitoActivo];
  const zona = CONFIG.zonas[estado.zonaActiva];
  const fuente = CONFIG.fuentes[estado.fuente];
  const datos = datosDe(estado.zonaActiva, estado.fuente);

  let dato = 'No hay datos cargados para esta zona y fuente.';
  if (datos && !datos.error) {
    const i = datos.anios.indexOf(hito.anio);
    if (i >= 0) {
      const valor = datos.valores[i];
      const pct = (datos.stats.anomalias[i] / datos.stats.media) * 100;
      dato = `En ${hito.anio}, según ${fuente.nombre}, cayeron ${formatearNumero(valor, 0)} mm en la ${zona.nombre}: ` +
             `un ${formatearNumero(Math.abs(pct), 0)}% ${pct >= 0 ? 'sobre' : 'bajo'} su promedio.`;
    } else {
      dato = `Esta fuente cubre de ${datos.stats.anioInicio} a ${datos.stats.anioFin}, así que no incluye ${hito.anio}. Prueba con la otra fuente en el panel de arriba.`;
    }
  }

  caja.innerHTML =
    `<p class="hito-detalle-ante"><span class="hito-simbolo simbolo-${hito.tipo}"></span>${hito.anio}, ${TIPOS_HITO[hito.tipo].etiqueta.toLowerCase()}</p>` +
    `<h4>${hito.titulo}</h4>` +
    `<p>${hito.texto}</p>` +
    `<p class="hito-dato">${dato}</p>` +
    `<p class="hito-cuidado"><strong>Ojo:</strong> ${hito.cuidado}</p>`;
}

function actualizarLineaTiempo() {
  const contenedor = $('#grafico-linea-tiempo');
  const datos = datosDe(estado.zonaActiva, estado.fuente);
  const zona = CONFIG.zonas[estado.zonaActiva];
  const fuente = CONFIG.fuentes[estado.fuente];
  const c = coloresTema();

  if (!datos || datos.error) {
    $('#ctx-linea-sub').textContent = 'No hay datos disponibles para esta zona y fuente.';
    Plotly.purge(contenedor);
    delete contenedor.dataset.clic;
    return;
  }

  const s = datos.stats;
  $('#ctx-linea-sub').textContent =
    `${zona.nombre}, ${fuente.etiqueta.toLowerCase()} (${s.anioInicio}–${s.anioFin}). Cambia la zona o la fuente en el panel de arriba.`;

  let maximo = 0;
  for (const v of datos.valores) if (v > maximo) maximo = v;

  const anioActivo = contexto.hitoActivo === null ? null : HITOS[contexto.hitoActivo].anio;
  const opacidades = [];
  for (const a of datos.anios) opacidades.push(anioActivo === null || a === anioActivo ? 0.9 : 0.3);

  const shapes = [];
  const hx = [], hy = [], htexto = [], hindice = [], hsimbolo = [], htamano = [];
  const conteoPorAnio = {};

  for (let i = 0; i < HITOS.length; i++) {
    const hito = HITOS[i];
    if (!filtroAcepta(hito)) continue;
    if (hito.anio < s.anioInicio || hito.anio > s.anioFin) continue;

    const activo = i === contexto.hitoActivo;
    const k = conteoPorAnio[hito.anio] || 0;
    conteoPorAnio[hito.anio] = k + 1;

    shapes.push({
      type: 'line', x0: hito.anio, x1: hito.anio, yref: 'paper', y0: 0, y1: 1,
      line: { color: activo ? c.tinta : c.otraFuente, width: activo ? 1.5 : 1, dash: activo ? 'solid' : 'dot' },
      layer: 'below'
    });
    hx.push(hito.anio);
    hy.push(maximo * (1.1 + 0.09 * k));
    htexto.push(hito.titulo);
    hindice.push(i);
    hsimbolo.push(TIPOS_HITO[hito.tipo].simbolo);
    htamano.push(activo ? 15 : 11);
  }

  const trazas = [
    {
      type: 'bar',
      x: datos.anios,
      y: datos.valores,
      marker: { color: c[estado.zonaActiva], opacity: opacidades },
      name: 'Lluvia anual',
      hovertemplate: '%{x}: %{y:,.0f} mm<extra></extra>'
    },
    {
      type: 'scatter',
      mode: 'markers',
      x: hx, y: hy,
      customdata: hindice,
      text: htexto,
      marker: { symbol: hsimbolo, size: htamano, color: c.tinta, line: { color: c.papel, width: 1.5 } },
      name: 'Hitos',
      hovertemplate: '%{x}: %{text}<extra></extra>'
    }
  ];

  const layout = Object.assign(layoutBase(c), {
    margin: { l: 56, r: 8, t: 10, b: 32 },
    xaxis: { showgrid: false, zeroline: false, linecolor: c.linea, ticks: 'outside', tickcolor: c.linea, dtick: 5 },
    yaxis: { gridcolor: c.linea, range: [0, maximo * 1.35], title: { text: 'mm al año', font: { size: 11 } } },
    showlegend: false,
    shapes: shapes,
    bargap: 0.2
  });

  Plotly.react(contenedor, trazas, layout, { responsive: true, displayModeBar: false });

  if (!contenedor.dataset.clic) {
    contenedor.on('plotly_click', evento => {
      const punto = evento.points[0];
      if (punto.customdata !== undefined) {
        seleccionarHito(punto.customdata);
        return;
      }
      for (let i = 0; i < HITOS.length; i++) {
        if (HITOS[i].anio === punto.x && filtroAcepta(HITOS[i])) {
          seleccionarHito(i);
          return;
        }
      }
    });
    contenedor.dataset.clic = '1';
  }
}

function actualizarMapaCalor() {
  const contenedor = $('#grafico-calor');
  const c = coloresTema();
  const ordenZonas = ['sur', 'centro', 'norte'];   // Plotly dibuja de abajo hacia arriba

  const aniosSet = new Set();
  for (const clave of ordenZonas) {
    const datos = datosDe(clave, estado.fuente);
    if (!datos || datos.error) continue;
    for (const a of datos.anios) aniosSet.add(a);
  }
  const anios = Array.from(aniosSet).sort((a, b) => a - b);

  if (anios.length === 0) {
    Plotly.purge(contenedor);
    return;
  }

  const filas = [];
  const nombres = [];
  for (const clave of ordenZonas) {
    const datos = datosDe(clave, estado.fuente);
    const fila = [];
    for (const a of anios) {
      if (!datos || datos.error) { fila.push(null); continue; }
      const i = datos.anios.indexOf(a);
      fila.push(i >= 0 ? (datos.stats.anomalias[i] / datos.stats.media) * 100 : null);
    }
    filas.push(fila);
    nombres.push(CONFIG.zonas[clave].nombre.replace('Zona ', ''));
  }

  const trazas = [{
    type: 'heatmap',
    x: anios,
    y: nombres,
    z: filas,
    zmin: -80, zmax: 80, zmid: 0,
    colorscale: [[0, c.norte], [0.5, c.papel2], [1, c.centro]],
    xgap: 2, ygap: 2,
    hovertemplate: '%{y}, %{x}: %{z:+.0f}% respecto de su promedio<extra></extra>',
    colorbar: {
      thickness: 10, outlinewidth: 0, len: 0.9,
      ticksuffix: '%', tickfont: { color: c.suave, size: 10 }
    }
  }];

  const layout = Object.assign(layoutBase(c), {
    margin: { l: 60, r: 8, t: 10, b: 32 },
    xaxis: { showgrid: false, zeroline: false, ticks: 'outside', tickcolor: c.linea, dtick: 5 },
    yaxis: { showgrid: false, zeroline: false, tickfont: { color: c.tinta } }
  });

  Plotly.react(contenedor, trazas, layout, { responsive: true, displayModeBar: false });
}

function actualizarAntesDespues() {
  const caja = $('#comparacion-zonas');
  const ANIO_CORTE = 2010;
  caja.innerHTML = '';
  let periodo = null;

  for (const clave of ['norte', 'centro', 'sur']) {
    const zona = CONFIG.zonas[clave];
    const datos = datosDe(clave, estado.fuente);
    if (!datos || datos.error) continue;

    let suma_antes = 0, n_antes = 0, suma_desde = 0, n_desde = 0;
    for (let i = 0; i < datos.anios.length; i++) {
      if (datos.anios[i] < ANIO_CORTE) { suma_antes += datos.valores[i]; n_antes++; }
      else { suma_desde += datos.valores[i]; n_desde++; }
    }
    if (n_antes === 0 || n_desde === 0) continue;

    const antes = suma_antes / n_antes;
    const desde = suma_desde / n_desde;
    const cambio = ((desde - antes) / antes) * 100;
    const maximo = Math.max(antes, desde);
    periodo = { inicio: datos.stats.anioInicio, fin: datos.stats.anioFin };

    const fila = document.createElement('div');
    fila.className = 'cz-fila';
    fila.style.setProperty('--z', `var(--${clave})`);
    fila.innerHTML =
      `<p class="cz-nombre">${zona.nombre}</p>` +
      `<div class="cz-barras">` +
        `<div class="cz-barra"><span class="cz-etiqueta">${datos.stats.anioInicio}–${ANIO_CORTE - 1}</span>` +
          `<span class="cz-pista"><span class="cz-relleno cz-antes" style="width:${(antes / maximo) * 100}%"></span></span>` +
          `<span class="cz-valor">${formatearNumero(antes, 0)} mm</span></div>` +
        `<div class="cz-barra"><span class="cz-etiqueta">${ANIO_CORTE}–${datos.stats.anioFin}</span>` +
          `<span class="cz-pista"><span class="cz-relleno" style="width:${(desde / maximo) * 100}%"></span></span>` +
          `<span class="cz-valor">${formatearNumero(desde, 0)} mm</span></div>` +
      `</div>` +
      `<p class="cz-cambio">${formatearConSigno(cambio, 0)}%</p>`;
    caja.appendChild(fila);
  }

  $('#comparacion-nota').textContent = periodo
    ? `Comparación descriptiva, sin test estadístico: una diferencia entre dos promedios no basta para hablar de tendencia ni de causa. ` +
      `Con ${CONFIG.fuentes[estado.fuente].etiqueta.toLowerCase()}, el período anterior va de ${periodo.inicio} a ${ANIO_CORTE - 1}.`
    : 'No hay datos suficientes para esta comparación.';
}

function actualizarContexto() {
  renderizarHitos();
  renderizarDetalle();
  actualizarLineaTiempo();
  actualizarMapaCalor();
  actualizarAntesDespues();
}

// Cuestionario

const preguntasQuiz = [
  {
    pregunta: 'Los satélites GPM IMERG de la NASA tienen datos desde 1998. ¿Cómo podemos mirar la lluvia desde 1970?',
    opciones: [
      'Extrapolando la tendencia satelital hacia atrás',
      'Comparando con un registro histórico de mediciones en tierra',
      'Con imágenes de satélites meteorológicos de los años setenta'
    ],
    correcta: 1,
    explicacion: 'El satélite cubre todo el territorio de forma pareja desde 1998, y el registro histórico permite mirar más atrás. En los años que comparten, sirven para comprobar que cuentan una historia parecida.'
  },
  {
    pregunta: '¿Qué zona recibe más lluvia al año?',
    opciones: ['Norte', 'Centro', 'Sur'],
    correcta: 2,
    explicacion: 'La Zona Sur recibe varias veces más lluvia que la Zona Centro, y muchísimo más que el norte.'
  },
  {
    pregunta: 'Un año tiene una anomalía de −200 mm. ¿Qué significa?',
    opciones: [
      'Que en ese año llovieron 200 mm en total',
      'Que llovieron 200 mm menos que el promedio del período',
      'Que llovieron 200 mm menos que el año anterior'
    ],
    correcta: 1,
    explicacion: 'La anomalía compara cada año con el promedio de toda la serie, no con el año anterior.'
  },
  {
    pregunta: 'En la Zona Centro, con el satélite (1998–2025) la baja no es significativa, pero con el registro histórico (1970–2025) sí. ¿Por qué puede pasar?',
    opciones: [
      'Porque una de las dos fuentes está equivocada',
      'Porque con más años una tendencia se distingue mejor de la variación natural entre años',
      'Porque el test solo funciona con datos de estaciones'
    ],
    correcta: 1,
    explicacion: 'Con pocos años, la variación natural tapa la tendencia. Por eso las series largas son tan valiosas para estudiar el clima.'
  }
];

const quiz = { indice: 0, puntaje: 0, terminado: false };

function mostrarPregunta() {
  const q = preguntasQuiz[quiz.indice];
  $('#quiz-progreso').textContent = `Pregunta ${quiz.indice + 1} de ${preguntasQuiz.length}`;
  $('#quiz-pregunta').textContent = q.pregunta;
  $('#quiz-feedback').hidden = true;
  $('#quiz-siguiente').hidden = true;

  const caja = $('#quiz-opciones');
  caja.innerHTML = '';
  for (let i = 0; i < q.opciones.length; i++) {
    const boton = document.createElement('button');
    boton.className = 'quiz-opcion';
    boton.textContent = q.opciones[i];
    boton.addEventListener('click', () => evaluarRespuesta(i));
    caja.appendChild(boton);
  }
}

function evaluarRespuesta(elegida) {
  const q = preguntasQuiz[quiz.indice];
  const botones = $$('.quiz-opcion');
  for (let i = 0; i < botones.length; i++) {
    botones[i].disabled = true;
    if (i === q.correcta) botones[i].classList.add('es-correcta');
    else if (i === elegida) botones[i].classList.add('es-incorrecta');
  }

  const acerto = elegida === q.correcta;
  if (acerto) quiz.puntaje++;

  const feedback = $('#quiz-feedback');
  feedback.textContent = (acerto ? 'Correcto. ' : 'No era esa. ') + q.explicacion;
  feedback.hidden = false;

  const siguiente = $('#quiz-siguiente');
  siguiente.textContent = quiz.indice === preguntasQuiz.length - 1 ? 'Ver resultado' : 'Siguiente pregunta';
  siguiente.hidden = false;
}

function mostrarResultado() {
  quiz.terminado = true;
  $('#quiz-progreso').textContent = 'Resultado';
  $('#quiz-pregunta').textContent = `Acertaste ${quiz.puntaje} de ${preguntasQuiz.length}.`;
  $('#quiz-opciones').innerHTML = '';
  $('#quiz-feedback').textContent = 'Puedes volver al mapa, cambiar de zona o de fuente y comparar las tendencias.';
  $('#quiz-feedback').hidden = false;
  $('#quiz-siguiente').textContent = 'Intentar de nuevo';
}

function avanzarQuiz() {
  if (quiz.terminado) {
    quiz.indice = 0;
    quiz.puntaje = 0;
    quiz.terminado = false;
    mostrarPregunta();
    return;
  }
  if (quiz.indice < preguntasQuiz.length - 1) {
    quiz.indice++;
    mostrarPregunta();
  } else {
    mostrarResultado();
  }
}

// Inicio

document.addEventListener('DOMContentLoaded', async () => {
  aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro');
  $('#tema-toggle').addEventListener('click', alternarTema);

  for (const boton of $$('.franja')) {
    boton.addEventListener('click', () => seleccionarZona(boton.dataset.zona));
  }
  for (const boton of $$('.fuente')) {
    boton.addEventListener('click', () => seleccionarFuente(boton.dataset.fuente));
  }
  for (const boton of $$('.vista')) {
    boton.addEventListener('click', () => {
      for (const otro of $$('.vista')) otro.classList.toggle('is-activa', otro === boton);
      estado.vista = boton.dataset.vista;
      actualizarGrafico();
    });
  }
  for (const boton of $$('.hito-filtro')) {
    boton.addEventListener('click', () => seleccionarFiltro(boton.dataset.tipo));
  }
  $('#hitos-lista').addEventListener('click', evento => {
    const boton = evento.target.closest('.hito-boton');
    if (boton) seleccionarHito(Number(boton.dataset.indice));
  });

  $('#toggle-tendencia').addEventListener('change', e => { estado.mostrarTendencia = e.target.checked; actualizarGrafico(); });
  $('#toggle-media-movil').addEventListener('change', e => { estado.mostrarMediaMovil = e.target.checked; actualizarGrafico(); });
  $('#toggle-comparar').addEventListener('change', e => { estado.compararFuentes = e.target.checked; actualizarGrafico(); });
  $('#quiz-siguiente').addEventListener('click', avanzarQuiz);

  mostrarPregunta();
  await cargarTodos();
  seleccionarZona(CONFIG.zonaInicial);
});
