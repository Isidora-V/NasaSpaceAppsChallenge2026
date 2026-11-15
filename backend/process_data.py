# Script backend de procesamiento encargado de la lectura, filtrado, validación de cobertura mínima 
# y conversión de los archivos CSV en bruto (tanto de fuentes NASA GPM IMERG como series 
# históricas NO_NASA) hacia un formato estructurado y limpio para la web.
from pathlib import Path
import pandas as pd

CARPETA_BACKEND = Path(__file__).resolve().parent
CARPETA_DATA = CARPETA_BACKEND / "data"

NASA_RAW = CARPETA_DATA / "NASA" / "raw"
NASA_CLEAN = CARPETA_DATA / "NASA" / "clean"
NO_NASA_RAW = CARPETA_DATA / "NO_NASA" / "raw"
NO_NASA_CLEAN = CARPETA_DATA / "NO_NASA" / "clean"

COBERTURA_MINIMA = 0.95  # fracción mínima de días con dato para aceptar un año (NASA)
ZONAS = ("norte", "centro", "sur")


def nombre_zona(nombre_archivo):
    nombre = nombre_archivo.lower()
    for zona in ZONAS:
        if nombre.startswith(zona):
            return zona
    raise ValueError(f"El archivo {nombre_archivo} debe empezar con norte, centro o sur")


# NASA (GPM IMERG diario, desde Giovanni)

def encontrar_inicio_tabla(ruta):
    with open(ruta, "r", encoding="utf-8", errors="ignore") as archivo:
        for i, linea in enumerate(archivo):
            if linea.strip().lower().startswith("time"):
                return i
    raise ValueError(f"No se encontró la fila 'time' en {ruta.name}")


def procesar_archivo_nasa(ruta):
    inicio = encontrar_inicio_tabla(ruta)
    df = pd.read_csv(ruta, skiprows=inicio)
    df.columns = df.columns.str.strip()
    df = df.rename(columns={df.columns[0]: "fecha", df.columns[1]: "mm_dia"})

    df["fecha"] = pd.to_datetime(df["fecha"], errors="coerce")
    df["mm_dia"] = pd.to_numeric(df["mm_dia"], errors="coerce")
    df.loc[df["mm_dia"] < -9000, "mm_dia"] = pd.NA  # valor de relleno -9999.9
    df = df.dropna(subset=["fecha", "mm_dia"])
    df["anio"] = df["fecha"].dt.year

    filas = []
    for anio, grupo in df.groupby("anio"):
        dias_esperados = pd.Timestamp(year=anio, month=12, day=31).dayofyear
        dias_con_dato = int(grupo["mm_dia"].count())
        cobertura = dias_con_dato / dias_esperados

        if cobertura < COBERTURA_MINIMA:
            print(f"   {anio}: descartado ({dias_con_dato} de {dias_esperados} días con dato)")
            continue

        precipitacion_anual = grupo["mm_dia"].mean() * dias_esperados
        filas.append({
            "anio": anio,
            "precipitacion_anual_mm": round(precipitacion_anual, 1),
            "dias_con_dato": dias_con_dato
        })

    return pd.DataFrame(filas)


# NO_NASA (serie anual histórica, ya en mm/año)

def procesar_archivo_no_nasa(ruta):
    df = pd.read_csv(ruta)
    df.columns = df.columns.str.strip()
    df = df.rename(columns={df.columns[0]: "anio", df.columns[1]: "precipitacion_anual_mm"})

    df["anio"] = pd.to_numeric(df["anio"], errors="coerce")
    df["precipitacion_anual_mm"] = pd.to_numeric(df["precipitacion_anual_mm"], errors="coerce")
    df = df.dropna(subset=["anio", "precipitacion_anual_mm"])
    df = df[df["precipitacion_anual_mm"] >= 0]
    df["anio"] = df["anio"].astype(int)

    duplicados = df["anio"].duplicated().sum()
    if duplicados > 0:
        print(f"   ADVERTENCIA: {duplicados} años repetidos, se conserva el primero")
        df = df.drop_duplicates(subset="anio", keep="first")

    return df[["anio", "precipitacion_anual_mm"]].sort_values("anio")


# Ejecución

def procesar_carpeta(carpeta_raw, carpeta_clean, funcion, etiqueta):
    archivos = sorted(carpeta_raw.glob("*.csv"))
    if not archivos:
        print(f"[{etiqueta}] No hay archivos CSV en {carpeta_raw}")
        return

    carpeta_clean.mkdir(parents=True, exist_ok=True)

    for ruta in archivos:
        zona = nombre_zona(ruta.name)
        print(f"[{etiqueta}] Procesando {zona}: {ruta.name}")
        anual = funcion(ruta)
        salida = carpeta_clean / f"{zona}_precipitacion_anual.csv"
        anual.to_csv(salida, index=False)
        print(f" -> {salida.relative_to(CARPETA_BACKEND)} ({len(anual)} años, "
              f"{anual['anio'].min()}–{anual['anio'].max()})")


def main():
    procesar_carpeta(NASA_RAW, NASA_CLEAN, procesar_archivo_nasa, "NASA")
    procesar_carpeta(NO_NASA_RAW, NO_NASA_CLEAN, procesar_archivo_no_nasa, "NO_NASA")


if __name__ == "__main__":
    main()
