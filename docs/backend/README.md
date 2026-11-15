# Backend folder

This folder contains the processing logic and datasets for the project, focused on annual precipitation time series in Chile. NASA GPM IMERG is the main source, and a non-NASA historical record is used as a complement.

## Content and Structure

- **data/**: Stores the datasets, split by source (`NASA/`, `NO_NASA/`) and by processing stage (`raw/`, `clean/`).
- **process_data.py**: Cleans both sources and writes one annual file per zone, in mm/year, with the same column names so the frontend can read them in the same way.

## Workflow Description

1. **NASA**: The script reads every CSV in `data/NASA/raw/`, removes the Giovanni metadata header, discards fill values (-9999.9), and converts daily precipitation into annual totals (mean daily value × days in the year). Years with less than 95% of days with data are discarded.
2. **NO_NASA**: The script reads every CSV in `data/NO_NASA/raw/`, which are already annual totals in mm/year. It standardizes the column names, removes empty, negative, or duplicated years, and sorts by year.
3. Both results are written as `<zone>_precipitacion_anual.csv` to their `clean/` folder. Raw file names must start with `norte`, `centro`, or `sur`.

## How to Run

```bash
pip install pandas
python backend/process_data.py
```