"use strict";

const utils = require("@iobroker/adapter-core");
const http = require("node:http");
const { URL } = require("node:url");

const DEFAULT_POLL_INTERVAL_SEC = 10;

const PORT_MODES = {
  OUTPUT: "output",
  PWM: "pwm",
  INPUT: "input",
  ANALOG: "analog"
};

const PORT_DEFS = [
  { idx: 0, key: "p0", label: "P0", mode: PORT_MODES.OUTPUT },
  { idx: 1, key: "p1", label: "P1", mode: PORT_MODES.OUTPUT },
  { idx: 2, key: "p2", label: "P2", mode: PORT_MODES.PWM },
  { idx: 3, key: "p3", label: "P3", mode: PORT_MODES.OUTPUT },
  { idx: 4, key: "p4", label: "P4", mode: PORT_MODES.OUTPUT },
  { idx: 5, key: "p5", label: "P5", mode: PORT_MODES.PWM },
  { idx: 6, key: "p6", label: "P6", mode: PORT_MODES.OUTPUT },
  { idx: 7, key: "p7", label: "P7", mode: PORT_MODES.INPUT },
  { idx: 8, key: "p8", label: "P8", mode: PORT_MODES.INPUT },
  { idx: 9, key: "p9", label: "P9", mode: PORT_MODES.ANALOG }
];

const I2C_SENSORS = [
  {
    port: 10,
    key: "bme280",
    label: "BME280",
    metrics: [
      { field: "bme_t", id: "temperature", role: "value.temperature", unit: "°C", decimals: 1 },
      { field: "bme_h", id: "humidity", role: "value.humidity", unit: "%", decimals: 1 },
      { field: "bme_p", id: "pressure", role: "value.pressure", unit: "hPa", decimals: 1 }
    ]
  },
  {
    port: 11,
    key: "bmp180",
    label: "BMP180",
    metrics: [
      { field: "bmp_t", id: "temperature", role: "value.temperature", unit: "°C", decimals: 1 },
      { field: "bmp_p", id: "pressure", role: "value.pressure", unit: "hPa", decimals: 1 }
    ]
  },
  {
    port: 12,
    key: "bh1750",
    label: "BH1750",
    metrics: [
      { field: "bh", id: "illuminance", role: "value.brightness", unit: "lx", decimals: 1 }
    ]
  },
  {
    port: 13,
    key: "sht31",
    label: "SHT31",
    metrics: [
      { field: "sht_t", id: "temperature", role: "value.temperature", unit: "°C", decimals: 1 },
      { field: "sht_h", id: "humidity", role: "value.humidity", unit: "%", decimals: 1 }
    ]
  },
  {
    port: 14,
    key: "sht21",
    label: "SHT21",
    metrics: [
      { field: "sht21_t", id: "temperature", role: "value.temperature", unit: "°C", decimals: 1 },
      { field: "sht21_h", id: "humidity", role: "value.humidity", unit: "%", decimals: 1 }
    ]
  },
  {
    port: 15,
    key: "ina219",
    label: "INA219",
    metrics: [
      { field: "ina_v", id: "voltage", role: "value.voltage", unit: "V", decimals: 2 },
      { field: "ina_i", id: "current", role: "value.current", unit: "mA", decimals: 1 }
    ]
  },
  {
    port: 16,
    key: "rtc",
    label: "RTC",
    metrics: [
      { field: "rtc", id: "time", role: "text", unit: "", decimals: null }
    ]
  },
  {
    port: 17,
    key: "cjmc8128",
    label: "CJMCU-8128",
    metrics: [
      { field: "cjmc_co2", id: "co2", role: "value.co2", unit: "ppm", decimals: 0 },
      { field: "cjmc_tvoc", id: "tvoc", role: "value.tvoc", unit: "ppb", decimals: 0 },
      { field: "cjmc_temp", id: "temperature", role: "value.temperature", unit: "°C", decimals: 1 },
      { field: "cjmc_hum", id: "humidity", role: "value.humidity", unit: "%", decimals: 1 }
    ]
  },
  {
    port: 18,
    key: "mcp23017",
    label: "MCP23017",
    metrics: [
      { field: "mcp_gpio", id: "gpio", role: "text", unit: "", decimals: null },
      { field: "mcp_gpioa", id: "porta", role: "value", unit: "", decimals: 0 },
      { field: "mcp_gpiob", id: "portb", role: "value", unit: "", decimals: 0 }
    ]
  },
  {
    port: 19,
    key: "lcd",
    label: "PCF8574 LCD",
    metrics: [
      { field: "lcd_line1", id: "line1", role: "text", unit: "", decimals: null },
      { field: "lcd_line2", id: "line2", role: "text", unit: "", decimals: null }
    ]
  },
  {
    port: 20,
    key: "ws281x",
    label: "WS281x",
    metrics: [
      { field: "ws_r", id: "red", role: "value", unit: "", decimals: 0 },
      { field: "ws_g", id: "green", role: "value", unit: "", decimals: 0 },
      { field: "ws_b", id: "blue", role: "value", unit: "", decimals: 0 }
    ]
  }
];

let adapter;
let pollTimer;
let hostConfig;
let password;

function startAdapter(options) {
  options = options || {};
  Object.assign(options, {
    name: "megaesp-modern"
  });
  adapter = new utils.Adapter(options);

  adapter.on("ready", onReady);
  adapter.on("stateChange", onStateChange);
  adapter.on("message", onMessage);
  adapter.on("unload", onUnload);

  return adapter;
}

function parseHost(address) {
  if (!address || typeof address !== "string") {
    return { host: "127.0.0.1", port: 80 };
  }
  if (!address.startsWith("http")) {
    address = "http://" + address;
  }
  const url = new URL(address);
  return {
    host: url.hostname,
    port: url.port ? parseInt(url.port, 10) : 80
  };
}

function httpRequest(path, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const options = {
      host: hostConfig.host,
      port: hostConfig.port,
      path,
      timeout
    };

    const req = http.get(options, res => {
      let data = "";
      res.setEncoding("utf8");

      res.on("data", chunk => {
        data += chunk;
      });

      res.on("end", () => {
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve((data || "").trim());
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

function httpRequestHost(host, port, path, timeout = 5000, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = { host, port, path, timeout, method, headers };
    const req = http.request(options, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => (data += chunk));
      res.on("end", () => {
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}: ${data}`);
          err.statusCode = res.statusCode;
          return reject(err);
        }
        resolve((data || "").trim());
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timeout")));
    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function buildQuery(params) {
  return Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
}

async function httpSec(params) {
  const qs = buildQuery(params);
  const path = `/sec/?${qs}`;
  return httpRequest(path);
}

async function onReady() {
  adapter.log.info("Initialising MegaESP modern adapter");

  hostConfig = parseHost(adapter.config.ip || adapter.config.host);
  password = (adapter.config.password || adapter.config.sec || "sec").trim();
  const pollIntervalMs = Math.max(3, parseInt(adapter.config.pollInterval, 10) || DEFAULT_POLL_INTERVAL_SEC) * 1000;

  await createObjects();
  await ensureDisplayDefaults();
  await pollAll();

  pollTimer = setInterval(() => pollAll().catch(err => {
    adapter.log.warn(`Polling failed: ${err.message}`);
  }), pollIntervalMs);

  adapter.subscribeStates("ports.*");
  adapter.subscribeStates("display.*");
  adapter.setState("info.connection", true, true);
}

async function onUnload(callback) {
  try {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    adapter.setState("info.connection", false, true);
    callback();
  } catch (err) {
    callback(err);
  }
}

function mapModeToPty(mode) {
  switch (mode) {
    case 0: return 0; // INPUT
    case 1: return 1; // OUTPUT SW
    case 2: return 4; // PWM
    case 3: return 2; // ADC
    case 4: return 3; // Digital Sensor
    default: return 255; // NC/unknown
  }
}

function mapPtyToMode(pty) {
  switch (pty) {
    case 0: return 0; // INPUT
    case 1: return 1; // OUTPUT SW
    case 4: return 2; // PWM
    case 2: return 3; // ADC
    case 3: return 4; // Digital Sensor
    default: return null; // ignore
  }
}

async function onMessage(obj) {
  if (!obj || !obj.command) return;
  const respond = (msg) => {
    if (obj.callback) {
      adapter.sendTo(obj.from, obj.command, msg, obj.callback);
    }
  };

  try {
    if (obj.command === 'discover') {
      // Keep simple: no network scan in adapter; user inputs IP manually
      return respond({ devices: [] });
    }

    if (obj.command === 'detectPorts') {
      const ip = (obj.message && obj.message.ip) || (adapter.config.ip || adapter.config.host);
      const pass = (obj.message && obj.message.password) || (adapter.config.password || adapter.config.sec || 'sec');
      const { host, port } = parseHost(ip);

      // Read current port states string (classic API)
      let response = '';
      try {
        response = await httpRequestHost(host, port, `/${encodeURIComponent(pass)}/?cmd=all`);
      } catch (e) {
        adapter.log.debug(`detectPorts: cmd=all failed: ${e.message}`);
      }

      // Read full config JSON
      let cfg = null;
      try {
        const cfgStr = await httpRequestHost(host, port, `/config.json`);
        cfg = JSON.parse(cfgStr);
      } catch (e) {
        adapter.log.warn(`detectPorts: /config.json failed: ${e.message}`);
      }

      let portsArr = [];
      if (cfg && Array.isArray(cfg.gpio)) {
        portsArr = cfg.gpio.map((g, idx) => {
          const pty = mapModeToPty(Number(g.mode));
          const out = { pty, name: `P${idx}` };
          if (pty === 0) { // input
            out.m = Number(g.trigger) || 0; // 0..2
            out.long = false;
            out.double = false;
          } else if (pty === 1) { // output
            out.d = Number(g.state) ? 1 : 0;
          } else if (pty === 4) { // pwm
            out.pwm = Math.max(0, Math.min(255, Number(g.state) || 0));
            out.d = out.pwm; // keep for UI that expects 'd'
          } else if (pty === 2) { // adc
            out.adc = 0; out.factor = 1; out.offset = 0;
          } else if (pty === 3) { // digital sensor
            out.m = 0;
            out.d = Number(g.sensorType) || 0; // 0 none, 1 DS18B20, 2 DHT22
          }
          // MCP/I2C ports not represented here; UI can add past index 9
          return out;
        });
      }

      return respond({ response, ports: portsArr });
    }

    if (obj.command === 'writeConfig') {
      const ip = (obj.message && obj.message.ip) || (adapter.config.ip || adapter.config.host);
      const pass = (obj.message && obj.message.password) || (adapter.config.password || adapter.config.sec || 'sec');
      const { host, port } = parseHost(ip);
      const incomingPorts = (obj.message && obj.message.ports) || [];

      // Load base config
      let cfgStr = await httpRequestHost(host, port, `/config.json`);
      let cfg = JSON.parse(cfgStr);
      if (!cfg || !Array.isArray(cfg.gpio)) {
        throw new Error('Invalid config.json from device');
      }

      // Apply ports mapping for the first N entries
      const gpio = cfg.gpio.map((g, idx) => {
        const inP = incomingPorts[idx];
        if (!inP || inP.pty === undefined) return g;
        const mode = mapPtyToMode(Number(inP.pty));
        if (mode === null) return g;
        const out = Object.assign({}, g);
        out.mode = mode;
        if (mode === 0) { // input
          out.trigger = Number(inP.m || 0);
          out.state = 0;
          out.sensorType = 0;
        } else if (mode === 1) { // output
          out.state = Number(inP.d || 0) ? 1 : 0;
          out.trigger = cfg.defaultTrigger || 2;
          out.sensorType = 0;
        } else if (mode === 2) { // pwm
          out.state = Math.max(0, Math.min(255, Number(inP.pwm !== undefined ? inP.pwm : inP.d || 0)));
          out.trigger = cfg.defaultTrigger || 2;
          out.sensorType = 0;
        } else if (mode === 3) { // analog
          out.state = 0;
          out.trigger = cfg.defaultTrigger || 2;
          out.sensorType = 0;
        } else if (mode === 4) { // digital sensor
          out.state = 0;
          out.trigger = cfg.defaultTrigger || 2;
          // map d: 1->DS18B20, 2->DHT22 else 0
          const st = Number(inP.d || 0);
          out.sensorType = (st === 1 || st === 2) ? st : 1;
        }
        return out;
      });

      const postDoc = { gpio };

      // If admin requested to change IP/password, include in POST
      if (obj.message && obj.message.config) {
        const cfgMsg = obj.message.config;
        if (cfgMsg.eip !== undefined || cfgMsg.pwd !== undefined) {
          postDoc.net = {};
          if (cfgMsg.eip) postDoc.net.ip = String(cfgMsg.eip);
          // Password change is not directly supported via /config.json in this firmware; ignore or handle if added
        }
        if (cfgMsg.port !== undefined) {
          // ignore; not used in firmware
        }
      }

      const body = JSON.stringify(postDoc);
      await httpRequestHost(host, port, `/config.json`, 10000, 'POST', body, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      });

      return respond({ ok: true });
    }
  } catch (e) {
    adapter.log.warn(`onMessage(${obj.command}) failed: ${e.message}`);
    if (obj && obj.callback) {
      adapter.sendTo(obj.from, obj.command, { error: e.message }, obj.callback);
    }
  }
}

async function createObjects() {
  await adapter.setObjectNotExistsAsync("info.connection", {
    type: "state",
    common: {
      name: "Connection state",
      type: "boolean",
      role: "indicator.connected",
      read: true,
      write: false,
      def: false
    },
    native: {}
  });

  for (const port of PORT_DEFS) {
    const baseId = `ports.${port.key}`;
    const baseName = port.label;
    const isOutput = port.mode === PORT_MODES.OUTPUT;
    const isInput = port.mode === PORT_MODES.INPUT;
    const isPwm = port.mode === PORT_MODES.PWM;
    const isAnalog = port.mode === PORT_MODES.ANALOG;

    await adapter.setObjectNotExistsAsync(baseId, {
      type: "channel",
      common: { name: baseName },
      native: { idx: port.idx, gpioLabel: port.label, mode: port.mode }
    });

    if (isOutput || isInput) {
      await adapter.setObjectNotExistsAsync(`${baseId}.state`, {
        type: "state",
        common: {
          name: `${baseName} state`,
          type: "boolean",
          role: isOutput ? "switch" : "sensor",
          read: true,
          write: isOutput
        },
        native: {}
      });
    }

    if (isPwm) {
      await adapter.setObjectNotExistsAsync(`${baseId}.level`, {
        type: "state",
        common: {
          name: `${baseName} PWM`,
          type: "number",
          role: "level.dimmer",
          read: true,
          write: true,
          min: 0,
          max: 255
        },
        native: {}
      });
    }

    if (isAnalog) {
      await adapter.setObjectNotExistsAsync(`${baseId}.value`, {
        type: "state",
        common: {
          name: `${baseName} analog`,
          type: "number",
          role: "value",
          read: true,
          write: false,
          min: 0,
          max: 1023
        },
        native: {}
      });
    }

    if (isInput) {
      await adapter.setObjectNotExistsAsync(`${baseId}.counter`, {
        type: "state",
        common: {
          name: `${baseName} counter`,
          type: "number",
          role: "value",
          read: true,
          write: true,
          def: 0
        },
        native: {}
      });
    }
  }

  // OneWire sensors channel
  await adapter.setObjectNotExistsAsync("sensors.onewire", {
    type: "channel",
    common: { name: "1-Wire sensors" },
    native: {}
  });

  // I2C sensors
  for (const sensor of I2C_SENSORS) {
    const baseId = `sensors.i2c.${sensor.key}`;
    await adapter.setObjectNotExistsAsync(baseId, {
      type: "channel",
      common: { name: `${sensor.label} (P${sensor.port})` },
      native: { port: sensor.port }
    });
    await adapter.setObjectNotExistsAsync(`${baseId}.port`, {
      type: "state",
      common: {
        name: "Virtual port",
        type: "string",
        role: "text",
        read: true,
        write: false
      },
      native: { port: sensor.port }
    });
    for (const metric of sensor.metrics) {
      await adapter.setObjectNotExistsAsync(`${baseId}.${metric.id}`, {
        type: "state",
        common: {
          name: `${sensor.label} ${metric.id}`,
          type: metric.decimals === null ? "string" : "number",
          role: metric.role,
          read: true,
          write: false,
          unit: metric.unit || undefined
        },
        native: { field: metric.field }
      });
    }
  }

  // Display channels (LCD/OLED)
  await adapter.setObjectNotExistsAsync("display", {
    type: "channel",
    common: { name: "Display" },
    native: {}
  });

  await adapter.setObjectNotExistsAsync("display.lcd", {
    type: "channel",
    common: { name: "LCD" },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.lcd.backlight", {
    type: "state",
    common: { name: "Backlight", type: "boolean", role: "switch", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.lcd.clear", {
    type: "state",
    common: { name: "Clear", type: "boolean", role: "button", read: false, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.lcd.row", {
    type: "state",
    common: { name: "Row", type: "number", role: "level", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.lcd.col", {
    type: "state",
    common: { name: "Col", type: "number", role: "level", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.lcd.text", {
    type: "state",
    common: { name: "Text", type: "string", role: "text", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.lcd.send", {
    type: "state",
    common: { name: "Send", type: "boolean", role: "button", read: false, write: true },
    native: {}
  });

  await adapter.setObjectNotExistsAsync("display.oled", {
    type: "channel",
    common: { name: "OLED" },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.invert", {
    type: "state",
    common: { name: "Invert", type: "boolean", role: "switch", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.clear", {
    type: "state",
    common: { name: "Clear", type: "boolean", role: "button", read: false, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.size", {
    type: "state",
    common: { name: "Size", type: "number", min: 1, max: 4, role: "level", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.row", {
    type: "state",
    common: { name: "Row", type: "number", role: "level", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.col", {
    type: "state",
    common: { name: "Col", type: "number", role: "level", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.text", {
    type: "state",
    common: { name: "Text", type: "string", role: "text", read: true, write: true },
    native: {}
  });
  await adapter.setObjectNotExistsAsync("display.oled.send", {
    type: "state",
    common: { name: "Send", type: "boolean", role: "button", read: false, write: true },
    native: {}
  });
}

async function ensureDisplayDefaults() {
  await adapter.setStateAsync("display.lcd.row", { val: 0, ack: true });
  await adapter.setStateAsync("display.lcd.col", { val: 0, ack: true });
  await adapter.setStateAsync("display.oled.row", { val: 0, ack: true });
  await adapter.setStateAsync("display.oled.col", { val: 0, ack: true });
  await adapter.setStateAsync("display.oled.size", { val: 1, ack: true });
}

async function pollAll() {
  await pollPorts();
  await pollOneWire();
  await pollI2C();
}

async function pollPorts() {
  try {
    const response = await httpRequest(`/${password}/?cmd=all`);
    if (!response) {
      return;
    }
    const parts = response.split(";");
    parts.forEach((raw, idx) => {
      const def = PORT_DEFS.find(p => p.idx === idx);
      if (!def) {
        return;
      }
      handlePortValue(def, raw);
    });
  } catch (err) {
    adapter.log.warn(`Failed to poll ports: ${err.message}`);
  }
}

function handlePortValue(def, raw) {
  const baseId = `ports.${def.key}`;
  if (def.mode === PORT_MODES.OUTPUT || def.mode === PORT_MODES.INPUT) {
    const { state, counter } = parseSwitchValue(raw);
    adapter.setState(`${baseId}.state`, state, true);
    if (counter !== null && def.mode === PORT_MODES.INPUT) {
      adapter.setState(`${baseId}.counter`, counter, true);
    }
  } else if (def.mode === PORT_MODES.PWM) {
    const value = parseFloat(raw);
    if (!Number.isNaN(value)) {
      adapter.setState(`${baseId}.level`, value, true);
    }
  } else if (def.mode === PORT_MODES.ANALOG) {
    const analog = parseFloat(raw);
    if (!Number.isNaN(analog)) {
      adapter.setState(`${baseId}.value`, analog, true);
    }
  }
}

function parseSwitchValue(raw) {
  if (!raw) {
    return { state: false, counter: null };
  }
  const parts = String(raw).split("/");
  const stateStr = parts[0].trim().toUpperCase();
  const state = stateStr === "ON" || stateStr === "1" || stateStr === "TRUE";
  let counter = null;
  if (parts.length > 1) {
    const parsed = parseInt(parts[1], 10);
    if (!Number.isNaN(parsed)) {
      counter = parsed;
    }
  }
  return { state, counter };
}

async function pollOneWire() {
  try {
    const response = await httpRequest(`/${password}/?pt=3&cmd=get`);
    if (!response) {
      return;
    }
    const pairs = response.split(";");
    for (const pair of pairs) {
      const [nameRaw, valueRaw] = pair.split("=");
      if (!nameRaw) continue;
      const name = nameRaw.trim();
      const id = sanitizeId(name);
      const value = parseNumber(valueRaw);
      await adapter.setObjectNotExistsAsync(`sensors.onewire.${id}`, {
        type: "state",
        common: {
          name: name,
          type: "number",
          role: "value.temperature",
          unit: "°C",
          read: true,
          write: false
        },
        native: { sensorName: name }
      });
      if (Number.isFinite(value)) {
        adapter.setState(`sensors.onewire.${id}`, value, true);
      } else {
        adapter.setState(`sensors.onewire.${id}`, null, true);
      }
    }
  } catch (err) {
    adapter.log.warn(`Failed to poll 1-Wire sensors: ${err.message}`);
  }
}

async function pollI2C() {
  await Promise.all(
    I2C_SENSORS.map(async sensor => {
      try {
        const response = await httpRequest(`/${password}/?pt=${sensor.port}&cmd=get`);
        const data = parseKeyValueList(response);
        const baseId = `sensors.i2c.${sensor.key}`;
        adapter.setState(`${baseId}.port`, `P${sensor.port}`, true);

        if (!data || Object.keys(data).length === 0) {
          sensor.metrics.forEach(metric => {
            adapter.setState(`${baseId}.${metric.id}`, null, true);
          });
          return;
        }

        sensor.metrics.forEach(metric => {
          if (metric.decimals === null) {
            const value = data[metric.field] || "";
            adapter.setState(`${baseId}.${metric.id}`, value, true);
          } else if (data[metric.field] !== undefined) {
            const numberValue = parseNumber(data[metric.field]);
            const rounded = Number.isFinite(numberValue)
              ? Number(numberValue.toFixed(metric.decimals))
              : null;
            adapter.setState(`${baseId}.${metric.id}`, rounded, true);
          } else {
            adapter.setState(`${baseId}.${metric.id}`, null, true);
          }
        });
      } catch (err) {
        adapter.log.debug(`I2C sensor P${sensor.port} polling failed: ${err.message}`);
      }
    })
  );
}

function parseKeyValueList(str) {
  if (!str || str.toUpperCase() === "NA") {
    return null;
  }
  return str.split(";").reduce((acc, item) => {
    const [key, value] = item.split("=");
    if (!key) return acc;
    acc[key.trim()] = value !== undefined ? value.trim() : "";
    return acc;
  }, {});
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return NaN;
  }
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : NaN;
}

function sanitizeId(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w\d_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function onStateChange(id, state) {
  if (!state || state.ack) {
    return;
  }

  // Handle display.* states
  if (id.startsWith(`${adapter.namespace}.display.`)) {
    try {
      if (id.endsWith("display.lcd.backlight")) {
        await httpSec({ lcd: 1, bl: state.val ? 1 : 2 });
        await adapter.setStateAsync(id, { val: !!state.val, ack: true });
        return;
      }
      if (id.endsWith("display.lcd.clear")) {
        await httpSec({ lcd: 1, cl: 1 });
        await adapter.setStateAsync(id, { val: false, ack: true });
        return;
      }
      if (id.endsWith("display.lcd.send")) {
        const [row, col, text] = await Promise.all([
          adapter.getStateAsync("display.lcd.row"),
          adapter.getStateAsync("display.lcd.col"),
          adapter.getStateAsync("display.lcd.text")
        ]);
        await httpSec({
          lcd: 1,
          row: Number(row?.val || 0),
          col: Number(col?.val || 0),
          cmd: String(text?.val || "")
        });
        await adapter.setStateAsync(id, { val: false, ack: true });
        return;
      }

      if (id.endsWith("display.oled.invert")) {
        await httpSec({ oled: 1, inv: state.val ? 1 : 0 });
        await adapter.setStateAsync(id, { val: !!state.val, ack: true });
        return;
      }
      if (id.endsWith("display.oled.clear")) {
        await httpSec({ oled: 1, cl: 1 });
        await adapter.setStateAsync(id, { val: false, ack: true });
        return;
      }
      if (id.endsWith("display.oled.send")) {
        const [row, col, size, text] = await Promise.all([
          adapter.getStateAsync("display.oled.row"),
          adapter.getStateAsync("display.oled.col"),
          adapter.getStateAsync("display.oled.size"),
          adapter.getStateAsync("display.oled.text")
        ]);
        const sz = Math.max(1, Math.min(4, Number(size?.val || 1)));
        await httpSec({
          oled: 1,
          row: Number(row?.val || 0),
          col: Number(col?.val || 0),
          size: sz,
          cmd: String(text?.val || "")
        });
        await adapter.setStateAsync(id, { val: false, ack: true });
        return;
      }
    } catch (err) {
      adapter.log.error(`Display command failed for ${id}: ${err.message}`);
    }
    return;
  }

  // Handle ports.* states
  const basePrefix = `${adapter.namespace}.ports.`;
  if (!id.startsWith(basePrefix)) {
    return;
  }

  const [portKey, property] = id.substring(basePrefix.length).split(".");
  if (!portKey || !property) {
    return;
  }

  const def = PORT_DEFS.find(p => p.key === portKey);
  if (!def) {
    adapter.log.warn(`Write attempt on unknown state ${id}`);
    return;
  }

  try {
    if (property === "state") {
      if (def.mode !== PORT_MODES.OUTPUT) {
        adapter.log.warn(`Write attempt on read-only state ${id}`);
        return;
      }
      const value = state.val ? 1 : 0;
      await writePortCommand(def.idx, value);
      adapter.setState(id, !!state.val, true);
    } else if (property === "level") {
      if (def.mode !== PORT_MODES.PWM) {
        adapter.log.warn(`PWM write attempted on non-PWM port ${def.label}`);
        return;
      }
      let value = parseInt(state.val, 10);
      if (Number.isNaN(value)) value = 0;
      value = Math.min(255, Math.max(0, value));
      await writePortCommand(def.idx, value);
      adapter.setState(id, value, true);
    } else if (property === "counter") {
      if (def.mode !== PORT_MODES.INPUT) {
        adapter.log.warn(`Counter write attempted on non-input port ${def.label}`);
        return;
      }
      let value = parseInt(state.val, 10);
      if (Number.isNaN(value) || value < 0) value = 0;
      await writeCounter(def.idx, value);
      adapter.setState(id, value, true);
    } else {
      adapter.log.warn(`Unhandled writable property ${property} for port ${def.label}`);
    }
  } catch (err) {
    adapter.log.error(`Failed to write ${id}: ${err.message}`);
  }
}

async function writePortCommand(portIdx, value) {
  await httpRequest(`/${password}/?cmd=${portIdx}:${value}`);
}

async function writeCounter(portIdx, value) {
  await httpRequest(`/${password}/?pt=${portIdx}&cnt=${value}`);
}

if (module.parent) {
  module.exports = startAdapter;
} else {
  startAdapter();
}
