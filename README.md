# MegaESP Modern ioBroker Adapter

This project is a clean-room rewrite of the classic `ioBroker.megaesp` adapter to match the extended firmware that now powers the Mega-ESP controller. The focus is on modern JavaScript, async operations, and exposing the richer HTTP API that was added to the firmware (virtual ports, 1-Wire naming, and I2C sensors).

## Key features

- Polls the device through the updated HTTP interface (`cmd=all`, `pt=<id>&cmd=get`, etc.).
- Mirrors the new virtual port map (P0–P9 on-board, P10+ for I2C sensors).
- Exposes 1-Wire sensors as individually named states that follow the `name=value` payload supplied by the firmware.
- Adds writable helpers for digital outputs, PWM outputs, and input counters.
- Keeps the adapter code compatible with Node.js 16+ and the latest `@iobroker/adapter-core`.
- Adds optional I²C peripherals: MCP23017 port expander (P18), PCF8574 LCD (P19), and WS281x colour control (P20).

## Port map

| Port | GPIO  | Mode          | ioBroker states                     |
|------|-------|---------------|-------------------------------------|
| P0   | GPIO5 | Output        | `ports.p0.state`                    |
| P1   | GPIO4 | Output        | `ports.p1.state`                    |
| P2   | GPIO15| Output PWM    | `ports.p2.level`                    |
| P3   | GPIO13| Output        | `ports.p3.state`                    |
| P4   | GPIO12| Output        | `ports.p4.state`                    |
| P5   | GPIO14| Output PWM    | `ports.p5.level`                    |
| P6   | GPIO16| Output        | `ports.p6.state`                    |
| P7   | GPIO0 | Digital input | `ports.p7.state`, `ports.p7.counter`|
| P8   | GPIO2 | Digital input | `ports.p8.state`, `ports.p8.counter`|
| P9   | ADC   | Analog input  | `ports.p9.value`                    |

Virtual ports P10+ are reserved for I2C sensors. The adapter keeps the firmware-provided sensor name, publishes a `port` state for the virtual port number, and adds dedicated states for each metric (temperature, humidity, pressure, CO₂, etc.). Recent additions include:

- P18 – MCP23017 (`mcp_gpio`, `mcp_gpioa`, `mcp_gpiob`).
- P19 – PCF8574 LCD (`lcd_line1`, `lcd_line2`).
- P20 – WS281x (`ws_r`, `ws_g`, `ws_b`).

## Configuration

The adapter expects the following configuration entries inside ioBroker:

- `ip` (or `host`): IP address (or `host:port`) of the Mega-ESP controller.
- `password` (or legacy `sec`): three-character password used by the firmware.
- `pollInterval`: seconds between polling rounds (defaults to 10).

All requests are plain HTTP `GET` calls to the ESP firmware (e.g. `http://<ip>/<password>/?cmd=all`). HTTPS is not supported by the firmware, so the adapter does not attempt it.

## Firmware API usage

- `cmd=all` – reads the current state for P0–P9 in one shot.
- `pt=<n>&cmd=get` – fetches detailed data for one virtual port. The adapter uses this for P3 (1-Wire summary) and for every configured I2C port.
- `pt=<n>&cnt=<value>` – resets the pulse counter on a digital input.
- `cmd=<n>:<value>` – writes either a boolean (0/1) value to digital outputs or a 0–255 level to PWM outputs.
- `pt=18&cmd=get` – returns MCP23017 state (`mcp_gpio`, `mcp_gpioa`, `mcp_gpiob`).
- `pt=19&cmd=get` – returns LCD lines; use `pt=19&line1=Hello&line2=World` to update the display text.
- `pt=20&cmd=get` – returns WS281x colour channels. Use `pt=20&r=128&g=64&b=0` (or `pt=3` for backwards compatibility) to set the RGB colour.

If the firmware returns `NA`, the adapter mirrors it as `null` in ioBroker so that downstream scripts can handle disconnected sensors gracefully.

## Development / testing checklist

1. Install dependencies once: `npm install`.
2. Provide a test configuration via ioBroker (or edit `adapter.config` if running standalone).
3. Start the adapter with `npm start` and watch the log output for connection issues.
4. Toggle a digital output (`ports.pX.state`) in ioBroker and confirm the device reacts.
5. Adjust a PWM value (`ports.p2.level` or `ports.p5.level`) and confirm the slider limits stay within 0–255.
6. Reset an input counter (`ports.p7.counter`) and verify the device-side counter is cleared.
7. Force sensor updates (touch 1-Wire/I2C sensors) and confirm the states update in ioBroker.
8. If MCP23017 is enabled, compare `mcp_gpioa/b` states with actual expander pin levels.
9. Update the LCD text via `pt=19&line1=...&line2=...` and check the values under `sensors.i2c.lcd.*`.
10. Set WS281x colour via `pt=20&r=...` (or `pt=3`) and confirm the adapter reflects the new RGB values.

The adapter does not bundle automated tests yet; integration testing against real hardware (or a HTTP mock) is recommended before publishing the package.
