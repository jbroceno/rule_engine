# Ofertas hipotecarias UI System

## Direction and Feel
- Product interface for a mortgage simulation tool, not a marketing site.
- Tone: trusted financial tool with warm paper surfaces and technical blue accents.
- Prioritize readability of tabular data, fast form completion, and clear simulation outcomes.

## Depth Strategy
- Primary strategy: borders and subtle surface layering.
- Surfaces use low-contrast borders with light opacity to separate content without harsh lines.
- Header is the highest visual layer; cards/forms/tables stay one level below.

## Spacing Base Unit
- Base spacing unit: 4px.
- Typical layout steps: 8, 12, 16, 24.
- Analytic mode reduces effective padding and gaps for denser information display.

## Typography
- Headings: Fraunces for strong section hierarchy and product character.
- Body/form text: IBM Plex Sans for clarity.
- Numeric highlights: IBM Plex Mono for scan-friendly values.

## Core Components
- Top header with segmented navigation pills and active state.
- Mode toggle lives in the same navigation row, aligned to the far right.
- Mode toggle uses an amber accent to stand out from blue navigation links without becoming loud.
- Mode toggle iconography is state-driven: line chart for analytic mode, briefcase for base mode.
- Rounded action buttons with visible focus and hover lift.
- Form blocks using field groups and consistent input focus ring.
- Metric summary cards with a small top accent marker.
- Data tables with soft header tint and zebra rows.
- Result cards for PRE and FINAL outputs with restrained status accents.

## Analytic Variant Pattern
- Toggle at app shell level to switch between base and analytic views.
- Toggle label and icon swap with state to make mode explicit at a glance.
- Analytic view tightens radii, padding, field density, and table row height.
- Keep color language consistent while increasing information density.
