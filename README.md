# Interactive Visualization of Precipitation Trends in Chile (NASA Space Apps Challenge 2026)

This project develops an interactive analysis and visualization platform to study precipitation trends across three macro-zones in Chile (North, Center, and South). Its main source is NASA's GPM IMERG satellite product (1998–2025), complemented by a historical annual precipitation record (1970–2025). Both sources are analyzed independently to translate climate data into accessible metrics on rainfall variability, drought, and long-term change.

## Repository Structure

```text
NasaSpaceAppsChallenge2026/
├── assets/                 # Static images (map of Chile)
├── backend/                # Data processing scripts and datasets
│   ├── data/
│   │   ├── NASA/           # GPM IMERG satellite data (raw and clean)
│   │   └── NO_NASA/        # Historical annual record, 1970–2025 (raw and clean)
│   └── process_data.py     # Cleans both sources and writes annual totals in mm/year
├── frontend/               # Interactive web interface (HTML, CSS, JavaScript)
└── README.md               # General project description
```

## Databases (Sources)

- **NASA Giovanni** (GES DISC), main source: Area-averaged daily precipitation from **GPM IMERG V07** (Late Run, `GPM_3IMERGDL_07`), 1998–2025.
- **Historical record** (non-NASA), complementary source: Annual precipitation per macro-zone, 1970–2025. [COMPLETAR: origin of the data (e.g., CR2 stations or product), and how it was averaged]

## Methodology

- Annual precipitation is expressed in mm/year. For NASA data, years with less than 95% of daily data are discarded.
- Both sources are analyzed separately and never spliced, to avoid an artificial break in 1998.
- Trend magnitude: Sen's slope (mm/decade).
- Trend significance: Mann-Kendall test with the Hamed–Rao correction for autocorrelation (α = 0.05).

## Tools Used and Required

- **Python 3** with **Pandas**: data cleaning and annual aggregation.
- **HTML5, CSS3, and JavaScript**: web interface and statistical calculations in the browser.
- **Plotly.js**: interactive charts.
- **Visual Studio Code** with the **Live Server** extension for local testing.

## Project Recreation

1. Clone the repository.
2. Run `python backend/process_data.py` to regenerate the clean files of both sources.
3. Open the **repository root folder** in VS Code and launch Live Server on `frontend/index.html`. Opening the file directly with a double click will not load the data.

Each main folder (`backend/` and `frontend/`) includes its own documentation with further details.

## Team Members

- [COMPLETAR] Name Surname: role
- [COMPLETAR] Name Surname: role
- [COMPLETAR] Name Surname: role