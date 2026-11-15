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

/* ---------- Formato ---------- */

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

/* ---------- Estadística ---------- */

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

// Corrección de Hamed y Rao (1998): infla la varianza de S según la autocorrelación
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

/* ---------- Datos ---------- */

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

/* ---------- Interfaz ---------- */

function seleccionarZona(clave) {
  estado.zonaActiva = clave;
  $('#mapa').dataset.activa = clave;

  for (const boton of $$('.franja')) {
    const activa = boton.dataset.zona === clave;
    boton.classList.toggle('is-activa', activa);
    boton.setAttribute('aria-pressed', activa ? 'true' : 'false');
  }

  document.documentElement.style.setProperty('--zona', CONFIG.zonas[clave].color);
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
  const zona = CONFIG.zonas[estado.zonaActiva];
  const datos = datosDe(estado.zonaActiva, estado.fuente);
  const esAnomalias = estado.vista === 'anomalias';

  $('.opciones-grafico').hidden = esAnomalias;

  if (!datos || datos.error) {
    cargador.textContent = 'No hay datos disponibles para esta zona y fuente.';
    cargador.classList.remove('is-oculto');
    Plotly.purge(contenedor);
    return;
  }

  const s = datos.stats;
  const tinta = '#1f1d1a';
  const suave = '#6a655b';
  const linea = '#e3ddd0';
  const trazas = [];

  if (esAnomalias) {
    const colores = [];
    for (const v of s.anomalias) colores.push(v >= 0 ? CONFIG.colorAnomaliaPositiva : CONFIG.colorAnomaliaNegativa);
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
          line: { color: CONFIG.colorOtraFuente, width: 1.5 },
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
      line: { color: zona.color, width: 2 },
      marker: { size: 5, color: zona.color },
      name: CONFIG.fuentes[estado.fuente].etiqueta,
      hovertemplate: '%{x}: %{y:,.0f} mm<extra></extra>'
    });

    if (estado.mostrarMediaMovil) {
      trazas.push({
        type: 'scatter', mode: 'lines',
        x: datos.anios, y: s.mediaMovil,
        line: { color: tinta, width: 1.5 },
        name: 'Media móvil 5 años', hoverinfo: 'skip'
      });
    }
    if (estado.mostrarTendencia) {
      trazas.push({
        type: 'scatter', mode: 'lines',
        x: datos.anios, y: s.lineaSen,
        line: { color: tinta, width: 1.5, dash: 'dash' },
        name: 'Tendencia (Sen)', hoverinfo: 'skip'
      });
    }
  }

  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    separators: ',.',
    font: { family: 'IBM Plex Sans, sans-serif', size: 12, color: suave },
    margin: { l: 56, r: 8, t: 36, b: 32 },
    xaxis: { showgrid: false, zeroline: false, linecolor: linea, ticks: 'outside', tickcolor: linea, dtick: 5 },
    yaxis: {
      gridcolor: linea,
      zeroline: esAnomalias, zerolinecolor: tinta,
      rangemode: esAnomalias ? 'normal' : 'tozero',
      title: { text: esAnomalias ? 'mm sobre o bajo el promedio' : 'mm al año', font: { size: 11 } }
    },
    showlegend: !esAnomalias,
    legend: { orientation: 'h', x: 0, y: 1.14, font: { size: 11, color: tinta } },
    bargap: 0.25
  };

  Plotly.react(contenedor, trazas, layout, { responsive: true, displayModeBar: false });
  cargador.classList.add('is-oculto');
}

/* ---------- Cuestionario ---------- */

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

/* ---------- Inicio ---------- */

document.addEventListener('DOMContentLoaded', async () => {
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

  $('#toggle-tendencia').addEventListener('change', e => { estado.mostrarTendencia = e.target.checked; actualizarGrafico(); });
  $('#toggle-media-movil').addEventListener('change', e => { estado.mostrarMediaMovil = e.target.checked; actualizarGrafico(); });
  $('#toggle-comparar').addEventListener('change', e => { estado.compararFuentes = e.target.checked; actualizarGrafico(); });
  $('#quiz-siguiente').addEventListener('click', avanzarQuiz);

  mostrarPregunta();
  await cargarTodos();
  seleccionarZona(CONFIG.zonaInicial);
});