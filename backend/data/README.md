# Data Folder

This folder stores the precipitation time series used by the project, separated by source and by processing stage.

## Directory Structure

- **NASA/raw/**: Original CSV files downloaded from NASA Giovanni (GPM IMERG V07, daily, area-averaged). They include a metadata header with the bounding box, date range, and fill value.
- **NASA/clean/**: Annual totals (mm/year) produced by `process_data.py`, one file per zone. Main source of the web interface.
- **NO_NASA/raw/**: Historical annual precipitation series per zone, 1970–2025, in mm/year. [COMPLETAR: origin of the data and averaging method]
- **NO_NASA/clean/**: Standardized version of the historical series produced by `process_data.py`, one file per zone.

## Zone Bounding Boxes (NASA)

- **North**: 18.1° S to 31.6° S, 72.3° W to 67.2° W
- **Center**: 31.8° S to 38.0° S, 73.4° W to 69.4° W
- **South**: 39.0° S to 53.6° S, 74.3° W to 72.1° W

The data was collected from the following websites:
- https://giovanni.gsfc.nasa.gov/giovanni/
- https://www.cr2.cl/