const previewRoot = document.getElementById("previewRoot");

const controls = {
  fontFamily: document.getElementById("fontFamily"),
  fontScale: document.getElementById("fontScale"),
  density: document.getElementById("density"),
  bgColor: document.getElementById("bgColor"),
  workspaceColor: document.getElementById("workspaceColor"),
  sidebarColor: document.getElementById("sidebarColor"),
  panelColor: document.getElementById("panelColor"),
  accentColor: document.getElementById("accentColor"),
  secondaryColor: document.getElementById("secondaryColor"),
  textColor: document.getElementById("textColor"),
  radiusScale: document.getElementById("radiusScale"),
  borderAlpha: document.getElementById("borderAlpha"),
  blurAmount: document.getElementById("blurAmount"),
  shellOpacity: document.getElementById("shellOpacity"),
  sidebarWidth: document.getElementById("sidebarWidth"),
  filesWidth: document.getElementById("filesWidth"),
  composerWidth: document.getElementById("composerWidth"),
  toggleFiles: document.getElementById("toggleFiles"),
  toggleTerminal: document.getElementById("toggleTerminal"),
  toggleCompact: document.getElementById("toggleCompact"),
  toggleBrandAccents: document.getElementById("toggleBrandAccents"),
  toggleFlatBrand: document.getElementById("toggleFlatBrand"),
};

const outputs = {
  fontScale: document.getElementById("fontScaleValue"),
  density: document.getElementById("densityValue"),
  radiusScale: document.getElementById("radiusScaleValue"),
  borderAlpha: document.getElementById("borderAlphaValue"),
  blurAmount: document.getElementById("blurAmountValue"),
  shellOpacity: document.getElementById("shellOpacityValue"),
  sidebarWidth: document.getElementById("sidebarWidthValue"),
  filesWidth: document.getElementById("filesWidthValue"),
  composerWidth: document.getElementById("composerWidthValue"),
};

const copyCustomizationButton = document.getElementById("copyCustomization");
const copyCustomizationStatus = document.getElementById("copyCustomizationStatus");

const exportedCssVariables = [
  "--font-sans",
  "--font-scale",
  "--density-y",
  "--radius-scale",
  "--mock-blur",
  "--bg",
  "--sidebar",
  "--workspace",
  "--panel",
  "--panel-2",
  "--panel-3",
  "--text",
  "--muted",
  "--muted-2",
  "--surface-hover",
  "--accent",
  "--accent-bg-subtle",
  "--accent-bg",
  "--accent-bg-strong",
  "--accent-border",
  "--brand-secondary",
  "--sidebar-width",
  "--files-width",
  "--composer-max-width",
  "--border",
  "--border-strong",
  "--composer-panel",
  "--composer-panel-2",
  "--composer-panel-3",
  "--composer-text",
  "--composer-muted",
  "--composer-muted-2",
  "--composer-accent",
  "--composer-accent-bg-subtle",
  "--composer-accent-bg",
  "--composer-accent-bg-strong",
  "--composer-accent-border",
];

const defaults = {
  fontFamily: '"Inter", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  fontScale: "100",
  density: "0",
  bgColor: "#1f1f1f",
  workspaceColor: "#151515",
  sidebarColor: "#1f1f1f",
  panelColor: "#2b2b2b",
  accentColor: "#d8d8d8",
  secondaryColor: "#9aa8b2",
  textColor: "#ededed",
  radiusScale: "100",
  borderAlpha: "7.5",
  blurAmount: "22",
  shellOpacity: "48",
  sidebarWidth: "300",
  filesWidth: "360",
  composerWidth: "800",
  toggleFiles: true,
  toggleTerminal: false,
  toggleCompact: false,
  toggleBrandAccents: false,
  toggleFlatBrand: false,
};

const presets = {
  current: defaults,
  blueprint: {
    ...defaults,
    bgColor: "#18202a",
    workspaceColor: "#101721",
    sidebarColor: "#1b2430",
    panelColor: "#26313d",
    accentColor: "#9fb6d8",
    secondaryColor: "#2e4664",
    textColor: "#eef5ff",
    borderAlpha: "10",
    blurAmount: "26",
  },
  warm: {
    ...defaults,
    bgColor: "#261f1a",
    workspaceColor: "#191513",
    sidebarColor: "#241f1b",
    panelColor: "#342b25",
    accentColor: "#e5c6a8",
    secondaryColor: "#7a5540",
    textColor: "#f1e9df",
    borderAlpha: "9.5",
    blurAmount: "18",
  },
  castrosua: {
    ...defaults,
    fontFamily: '"Exo 2", "Inter", ui-sans-serif, system-ui, sans-serif',
    bgColor: "#111821",
    workspaceColor: "#0f141a",
    sidebarColor: "#121b24",
    panelColor: "#202833",
    accentColor: "#d4b44a",
    secondaryColor: "#002b4f",
    textColor: "#eef3f7",
    fontScale: "101",
    radiusScale: "98",
    borderAlpha: "10",
    blurAmount: "22",
    shellOpacity: "58",
    sidebarWidth: "308",
    filesWidth: "368",
    composerWidth: "820",
    toggleBrandAccents: true,
  },
  castrosuaGraphite: {
    ...defaults,
    bgColor: "#181b1f",
    workspaceColor: "#111315",
    sidebarColor: "#171b20",
    panelColor: "#24282d",
    accentColor: "#c7aa48",
    secondaryColor: "#00355f",
    textColor: "#f0f2f4",
    borderAlpha: "9.5",
    blurAmount: "20",
    shellOpacity: "54",
    toggleBrandAccents: true,
  },
  castrosuaGraphiteFlat: {
    ...defaults,
    fontFamily: '"Exo 2", "Inter", ui-sans-serif, system-ui, sans-serif',
    bgColor: "#181b1f",
    workspaceColor: "#111315",
    sidebarColor: "#171b20",
    panelColor: "#24282d",
    accentColor: "#c7aa48",
    secondaryColor: "#00355f",
    textColor: "#f0f2f4",
    density: "3",
    radiusScale: "96",
    borderAlpha: "10",
    blurAmount: "20",
    shellOpacity: "50",
    sidebarWidth: "305",
    filesWidth: "400",
    composerWidth: "840",
    toggleBrandAccents: true,
    toggleFlatBrand: true,
  },
  castrosuaMidnight: {
    ...defaults,
    fontFamily: '"Exo 2", "Inter", ui-sans-serif, system-ui, sans-serif',
    bgColor: "#061827",
    workspaceColor: "#07111d",
    sidebarColor: "#092033",
    panelColor: "#10283e",
    accentColor: "#d8bd56",
    secondaryColor: "#002b4f",
    textColor: "#f3f7fa",
    fontScale: "101",
    radiusScale: "92",
    borderAlpha: "11.5",
    blurAmount: "24",
    shellOpacity: "66",
    sidebarWidth: "312",
    filesWidth: "376",
    composerWidth: "820",
    toggleBrandAccents: true,
  },
  castrosuaSignal: {
    ...defaults,
    fontFamily: '"Exo 2", "Inter", ui-sans-serif, system-ui, sans-serif',
    bgColor: "#0d1720",
    workspaceColor: "#0c1117",
    sidebarColor: "#101b26",
    panelColor: "#1b2530",
    accentColor: "#ffcf1c",
    secondaryColor: "#002b4f",
    textColor: "#f4f7fb",
    fontScale: "101",
    radiusScale: "94",
    borderAlpha: "10.5",
    blurAmount: "20",
    shellOpacity: "56",
    sidebarWidth: "308",
    filesWidth: "368",
    composerWidth: "820",
    toggleBrandAccents: true,
  },
  highContrast: {
    ...defaults,
    bgColor: "#070707",
    workspaceColor: "#050505",
    sidebarColor: "#090909",
    panelColor: "#161616",
    accentColor: "#ffffff",
    secondaryColor: "#000000",
    textColor: "#ffffff",
    fontScale: "104",
    borderAlpha: "18",
    radiusScale: "86",
    blurAmount: "4",
  },
};

function hexToRgb(hex) {
  const clean = hex.replace("#", "").trim();
  const value = Number.parseInt(clean.length === 3
    ? clean.split("").map((ch) => ch + ch).join("")
    : clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function clamp(value, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

function shade(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const next = {
    r: clamp(Math.round(r + amount)),
    g: clamp(Math.round(g + amount)),
    b: clamp(Math.round(b + amount)),
  };
  return `#${[next.r, next.g, next.b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function setVar(name, value) {
  previewRoot.style.setProperty(name, value);
}

function getCustomizationSnapshot() {
  const computedStyle = window.getComputedStyle(previewRoot);
  const cssVariables = Object.fromEntries(
    exportedCssVariables.map((name) => [name, computedStyle.getPropertyValue(name).trim()]),
  );

  return {
    exportedAt: new Date().toISOString(),
    customizationOptions: {
      fontFamily: controls.fontFamily.value,
      fontScalePercent: Number(controls.fontScale.value),
      density: Number(controls.density.value),
      colors: {
        background: controls.bgColor.value,
        workspace: controls.workspaceColor.value,
        sidebar: controls.sidebarColor.value,
        panel: controls.panelColor.value,
        accent: controls.accentColor.value,
        secondaryAccent: controls.secondaryColor.value,
        text: controls.textColor.value,
      },
      radiusScalePercent: Number(controls.radiusScale.value),
      borderStrengthPercent: Number(controls.borderAlpha.value),
      glassBlurPx: Number(controls.blurAmount.value),
      shellOpacityPercent: Number(controls.shellOpacity.value),
      layout: {
        sidebarWidthPx: Number(controls.sidebarWidth.value),
        projectFilesWidthPx: Number(controls.filesWidth.value),
        composerMaxWidthPx: Number(controls.composerWidth.value),
      },
      toggles: {
        projectFilesDock: controls.toggleFiles.checked,
        terminalDrawer: controls.toggleTerminal.checked,
        compactGalleryCards: controls.toggleCompact.checked,
        brandAccentStripe: controls.toggleBrandAccents.checked,
        flatBrandAccents: controls.toggleFlatBrand.checked,
      },
    },
    cssVariables,
  };
}

function setCopyStatus(message, tone = "") {
  copyCustomizationStatus.textContent = message;
  if (tone) {
    copyCustomizationStatus.dataset.tone = tone;
  } else {
    delete copyCustomizationStatus.dataset.tone;
  }
}

async function writeTextToClipboard(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

async function copyCustomizationOptions() {
  applyControls();
  const payload = JSON.stringify(getCustomizationSnapshot(), null, 2);
  try {
    await writeTextToClipboard(payload);
    setCopyStatus("Copied customization JSON to clipboard.", "success");
  } catch (error) {
    console.error(error);
    setCopyStatus("Copy failed. Your browser may block clipboard access for local files.", "error");
  }
}

function applyControls() {
  const fontScale = Number(controls.fontScale.value) / 100;
  const density = Number(controls.density.value);
  const radiusScale = Number(controls.radiusScale.value) / 100;
  const borderAlpha = Number(controls.borderAlpha.value) / 100;
  const blur = Number(controls.blurAmount.value);
  const shellOpacity = Number(controls.shellOpacity.value) / 100;
  const sidebarAlpha = Math.max(0.16, Math.min(0.84, shellOpacity * 0.75));

  setVar("--font-sans", controls.fontFamily.value);
  setVar("--font-scale", String(fontScale));
  setVar("--density-y", `${density / 4}px`);
  setVar("--radius-scale", String(radiusScale));
  setVar("--sidebar-width", `${controls.sidebarWidth.value}px`);
  setVar("--files-width", `${controls.filesWidth.value}px`);
  setVar("--composer-max-width", `${controls.composerWidth.value}px`);
  setVar("--mock-blur", `${blur}px`);

  setVar("--bg", rgba(controls.bgColor.value, shellOpacity));
  setVar("--sidebar", rgba(controls.sidebarColor.value, sidebarAlpha));
  setVar("--workspace", controls.workspaceColor.value);
  const usingDefaultPanel = controls.panelColor.value.toLowerCase() === defaults.panelColor;
  const usingDefaultText = controls.textColor.value.toLowerCase() === defaults.textColor;
  const usingDefaultAccent = controls.accentColor.value.toLowerCase() === defaults.accentColor;

  setVar("--panel", controls.panelColor.value);
  setVar("--panel-2", usingDefaultPanel ? "#252525" : shade(controls.panelColor.value, -6));
  setVar("--panel-3", usingDefaultPanel ? "#303030" : shade(controls.panelColor.value, 5));
  setVar("--text", controls.textColor.value);
  setVar("--muted", usingDefaultText ? "#a7a7a7" : rgba(controls.textColor.value, 0.68));
  setVar("--muted-2", usingDefaultText ? "#737373" : rgba(controls.textColor.value, 0.45));
  setVar("--surface-hover", rgba(controls.textColor.value, 0.055));

  setVar("--accent", controls.accentColor.value);
  setVar("--accent-bg-subtle", rgba(controls.accentColor.value, 0.08));
  setVar("--accent-bg", rgba(controls.accentColor.value, 0.14));
  setVar("--accent-bg-strong", rgba(controls.accentColor.value, 0.22));
  setVar("--accent-border", rgba(controls.accentColor.value, 0.28));
  setVar("--brand-secondary", controls.secondaryColor.value);

  setVar("--composer-panel", usingDefaultPanel ? "#202020" : shade(controls.panelColor.value, -11));
  setVar("--composer-panel-2", usingDefaultPanel ? "#1c1c1c" : shade(controls.panelColor.value, -15));
  setVar("--composer-panel-3", usingDefaultPanel ? "#262626" : shade(controls.panelColor.value, -5));
  setVar("--composer-text", usingDefaultText ? "#d8d8dc" : rgba(controls.textColor.value, 0.88));
  setVar("--composer-muted", usingDefaultText ? "#8f929b" : rgba(controls.textColor.value, 0.62));
  setVar("--composer-muted-2", usingDefaultText ? "#6f7480" : rgba(controls.textColor.value, 0.46));
  setVar("--composer-accent", usingDefaultAccent ? "#9aa8b2" : controls.accentColor.value);
  setVar("--composer-accent-bg-subtle", usingDefaultAccent ? "rgba(113, 136, 148, 0.07)" : rgba(controls.accentColor.value, 0.07));
  setVar("--composer-accent-bg", usingDefaultAccent ? "rgba(113, 136, 148, 0.12)" : rgba(controls.accentColor.value, 0.12));
  setVar("--composer-accent-bg-strong", usingDefaultAccent ? "rgba(113, 136, 148, 0.18)" : rgba(controls.accentColor.value, 0.18));
  setVar("--composer-accent-border", usingDefaultAccent ? "rgba(88, 112, 123, 0.58)" : rgba(controls.accentColor.value, 0.24));

  setVar("--border", `rgba(255, 255, 255, ${borderAlpha})`);
  setVar("--border-strong", `rgba(255, 255, 255, ${Math.min(0.34, borderAlpha * 1.9)})`);

  document.documentElement.style.setProperty("--lab-accent", controls.accentColor.value);

  previewRoot.classList.toggle("files-hidden", !controls.toggleFiles.checked);
  previewRoot.classList.toggle("terminal-on", controls.toggleTerminal.checked);
  previewRoot.classList.toggle("compact-gallery", controls.toggleCompact.checked);
  previewRoot.classList.toggle("brand-accents", controls.toggleBrandAccents.checked);
  previewRoot.classList.toggle("brand-accents-flat", controls.toggleFlatBrand.checked);

  outputs.fontScale.textContent = `${controls.fontScale.value}%`;
  outputs.density.textContent = density > 0 ? `+${density}` : String(density);
  outputs.radiusScale.textContent = `${radiusScale.toFixed(2)}×`;
  outputs.borderAlpha.textContent = `${controls.borderAlpha.value}%`;
  outputs.blurAmount.textContent = `${blur}px`;
  outputs.shellOpacity.textContent = `${controls.shellOpacity.value}%`;
  outputs.sidebarWidth.textContent = `${controls.sidebarWidth.value}px`;
  outputs.filesWidth.textContent = `${controls.filesWidth.value}px`;
  outputs.composerWidth.textContent = `${controls.composerWidth.value}px`;
}

function applyPreset(name) {
  const preset = presets[name] ?? defaults;
  for (const [key, value] of Object.entries(preset)) {
    const control = controls[key];
    if (!control) continue;
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
    } else {
      control.value = String(value);
    }
  }
  applyControls();
}

for (const control of Object.values(controls)) {
  control.addEventListener("input", applyControls);
  control.addEventListener("change", applyControls);
}

for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}

copyCustomizationButton.addEventListener("click", () => {
  void copyCustomizationOptions();
});

document.getElementById("resetMock").addEventListener("click", () => {
  applyPreset("current");
  setCopyStatus("");
});

applyControls();
