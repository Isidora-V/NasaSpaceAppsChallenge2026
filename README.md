# Interactive Visualization of Precipitation Trends in Chile (NASA Space Apps Challenge 2026)

This project develops an interactive analysis and visualization platform to study precipitation trends across three macro-zones in Chile (North, Center, and South). Its main source is NASA's GPM IMERG satellite product (1998–2025), complemented by a historical annual precipitation record (1970–2025). Both sources are analyzed independently to translate climate data into accessible metrics on rainfall variability, drought, and long-term change. Beyond the trend analysis, the platform includes a context section that places rainfall alongside known climate events, wildfires, and water legislation through an interactive timeline, a heatmap of dry and wet years across zones, and a before-and-after-2010 comparison, always stating explicitly that correlation does not imply causation. The site also offers a light and dark mode, and outlines future work linking precipitation to wildfires, urban expansion, environmental legislation, and other territorial factors.

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
├── docs/                   # Published copy of the site for GitHub Pages (generated, do not edit)
├── actualizar_docs.py      # Regenerates docs/ from frontend/, assets/ and the clean data
└── README.md               # General project description
```

## Databases (Sources)

- **NASA Giovanni** (GES DISC), main source: [Area-averaged daily precipitation from **GPM IMERG V07** (Late Run, `GPM_3IMERGDL_07`), 1998–2025.](https://giovanni.gsfc.nasa.gov/giovanni/)
- **Historical record CR2** (non-NASA), complementary source: [Annual precipitation per macro-zone, CR2, 1970–2025.](https://www.cr2.cl/)

## Methodology

### Data Sources
- **NASA GPM IMERG V07** (main source): Area-averaged daily precipitation (Late Run, `GPM_3IMERGDL_07`) downloaded from NASA Giovanni for three bounding boxes: North (18.1° S to 31.6° S), Center (31.8° S to 38.0° S), and South (39.0° S to 53.6° S). Period: 1998–2025.
- **CR2 historical record** (complementary source): Annual precipitation per macro-zone, 1970–2025, in mm/year, obtained from CR2 (https://www.cr2.cl/) and stored in `NO_NASA/`. The specific CR2 product or stations and the aggregation method per zone were not documented during the hackathon. For this reason it is used only as a complement, NASA IMERG remains the main source, and its agreement with IMERG is reported in the Limitations section.

### Data Processing
- Raw files are processed with `backend/process_data.py`, which writes one annual file per zone and source to each `clean/` folder, using the same column names for both sources.
- **NASA**: The Giovanni metadata header and fill values (-9999.9) are removed. Annual precipitation (mm/year) is computed as the mean daily value multiplied by the number of days in the year. Years with less than 95% of days with data are discarded, which excludes the current incomplete year (2026).
- **Historical record**: Values are already annual totals in mm/year. The script standardizes column names and removes empty, negative, or duplicated years.
- Both sources are analyzed separately and **never spliced** into a single series, since joining two instruments with different levels would create an artificial break in 1998.

### Trend Analysis
- **Trend magnitude**: Sen's slope, the median of the slopes between all pairs of years, reported in mm/decade. It was chosen over ordinary least squares because annual rainfall is skewed and contains extreme years (such as El Niño years), and Sen's slope is resistant to them (breakdown point of about 29%, compared with 0% for least squares).
- **Trend significance**: Mann-Kendall test (α = 0.05), a non-parametric test that does not assume normality. It is applied with the **Hamed–Rao correction**, which inflates the variance of the test statistic when the series shows significant autocorrelation, since consecutive dry years would otherwise make the trend look more significant than it is.
- **Change over the period**: Percentage difference between the values of Sen's trend line in the first and last year.
- **Anomalies**: Difference between each year and the mean of its series.
- **Smoothing**: Centered 5-year moving average, used only as a visual aid.
- All statistics are computed in the browser (`frontend/js/script.js`) from the clean CSV files.

### Context Section
- **Timeline**: Annual precipitation of the selected zone and source shown alongside known climate events (El Niño and La Niña, the 2010 megadrought onset, extremely dry years), territorial events (major wildfires), and water-related legislation. For each event, the page computes that year's rainfall and its deviation from the zone's mean.
- **Heatmap**: Yearly precipitation anomalies (% relative to each zone's own mean) for the three zones at once, to see whether dry and wet years are shared across the country.
- **Before and after 2010**: Mean annual precipitation before 2010 and from 2010 onward for each zone. This comparison is descriptive and does not include a statistical test.
- Every element states that **correlation does not imply causation**: events are shown as context to raise better questions, not as proven causes.

### Interface
- Interactive map of Chile where the silhouette is colored by the selected zone, a data source selector, metric cards, and Plotly charts (yearly series, anomalies, trend line, moving average, and an optional comparison between sources).
- An auto-generated text summary explains each result in plain language, including whether the trend is statistically significant.
- Light and dark mode, saved in the browser with `localStorage` and defaulting to the user's system preference.

### Limitations
- The IMERG series covers only 28 years, which limits the power to detect trends given the high year-to-year variability.
- The Late Run product is a near-real-time estimate. The Final Run (`GPM_3IMERGDF`), calibrated with rain gauges, would be more appropriate for climate analysis.
- The NASA bounding boxes do not follow Chile's borders exactly. They include parts of neighboring countries and ocean, and they leave a gap between 38° S and 39° S.
- The two sources agree well in the Center zone (correlation 0.87 for 1998–2025) but less in the North and South (about 0.45). In the South, the historical record shows notably lower values than IMERG for 2020–2025, which should be verified.
- Sen's slope assumes a gradual monotonic change. An abrupt shift, such as the 2010 megadrought onset, would be better described with a change-point test (for example, Pettitt's test).

## Tools Used and Required

- **Python 3** with **Pandas**: data cleaning and annual aggregation.
- **HTML5, CSS3, and JavaScript**: web interface and statistical calculations in the browser.
- **Plotly.js**: interactive charts.
- **Visual Studio Code** with the **Live Server** extension for local testing.
- **GitHub Pages**: hosting of the public website.

## Project Usage and Recreation

You can visit the website directly at the following link: https://isidora-v.github.io/NasaSpaceAppsChallenge2026/

Or if you wish to recreate or work directly with the project:

1. Clone the repository.
2. Run `python backend/process_data.py` to regenerate the clean files of both sources.
3. Open the **repository root folder** in VS Code and launch Live Server on `frontend/index.html`. Opening the file directly with a double click will not load the data.

Each main folder (`backend/` and `frontend/`) includes its own documentation with further details.

The published site is served from `docs/`, which is generated automatically. After any change, run `python actualizar_docs.py` before pushing. Do not edit files inside `docs/` directly.

## AI declaration

Artificial intelligence tools (Claude, Gemini) were used as a supporting assistant during project development, specifically for code debugging, understanding the NASA database, and deployment tasks. The core concept of the website, the project architecture (including the design of the backend, frontend, and data-preparation scripts), as well as the design of the questionnaires, the statistical tools, and the data analysis and visualizations, are entirely our original work. AI was used strictly for technical implementation support and debugging.

## Team Members

- Fernanda Bobadilla: Data Analysis, Cleaning, and Processing.
- Isidora Mora: Design, Web Development, and Visualization.
- Isidora Vargas: Web Development and Visualization.
