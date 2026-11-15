# Este archivo se encarga de actualizar la carpeta docs/ 
# con los archivos necesarios para el despliegue del sitio web.

from pathlib import Path
import shutil

RAIZ = Path(__file__).resolve().parent
DOCS = RAIZ / "docs"

COPIAS = [
    ("frontend", "frontend"),
    ("assets", "assets"),
    ("backend/data/NASA/clean", "backend/data/NASA/clean"),
    ("backend/data/NO_NASA/clean", "backend/data/NO_NASA/clean"),
]

REDIRECCION = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=frontend/">
  <title>Lluvia en Chile</title>
</head>
<body>
  <p><a href="frontend/">Ir al sitio</a></p>
</body>
</html>
"""


def main():
    if DOCS.exists():
        shutil.rmtree(DOCS)
    DOCS.mkdir()

    for origen, destino in COPIAS:
        ruta_origen = RAIZ / origen
        ruta_destino = DOCS / destino
        if not ruta_origen.exists():
            print(f"ADVERTENCIA: no existe {origen}, se omite")
            continue
        shutil.copytree(ruta_origen, ruta_destino, ignore=shutil.ignore_patterns("README.md", ".gitkeep"))
        cantidad = 0
        for archivo in ruta_destino.rglob("*"):
            if archivo.is_file():
                cantidad += 1
        print(f"Copiado {origen} -> docs/{destino} ({cantidad} archivos)")

    (DOCS / "index.html").write_text(REDIRECCION, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")
    print("docs/ actualizado.")


if __name__ == "__main__":
    main()