# Frontend folder

This folder contains the user interface and client-side logic for the project. It delivers an interactive visualization of precipitation data across Chile, consuming the clean datasets stored in the backend.

## Directory Structure

- **css/**: Style sheets for layout, typography, and the interactive map.
- **js/**: Scripts for data loading, statistical calculations, and interface updates.
- **index.html**: The main entry point of the web application.

## Overview

The frontend is the presentation layer. Users select a zone on the map of Chile and a data source (NASA satellite by default, or the historical record), and the page shows the mean annual precipitation, Sen's slope, the Mann-Kendall significance, and an interactive chart with the yearly series, anomalies, moving average, trend line, and an optional comparison between both sources.

## How to Run

Open the repository root folder in VS Code and launch Live Server on `frontend/index.html`. The page reads files from `../backend/` and `../assets/`, so it must be served from the root.