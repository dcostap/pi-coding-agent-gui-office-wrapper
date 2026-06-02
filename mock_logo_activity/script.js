const chatWindow = document.getElementById("chatWindow");
const animationSelect = document.getElementById("animationSelect");
const statusSelect = document.getElementById("statusSelect");
const sizeRange = document.getElementById("sizeRange");
const speedRange = document.getElementById("speedRange");
const glowRange = document.getElementById("glowRange");
const labelToggle = document.getElementById("labelToggle");
const goldToggle = document.getElementById("goldToggle");

const outputs = {
  size: document.getElementById("sizeValue"),
  speed: document.getElementById("speedValue"),
  glow: document.getElementById("glowValue"),
};

const presets = {
  enterprise: { animation: "focus", status: "Working", size: 32, speed: 85, glow: 30, label: true, gold: true },
  friendly: { animation: "pulse", status: "Thinking", size: 36, speed: 100, glow: 46, label: true, gold: true },
  technical: { animation: "scan", status: "Reviewing files", size: 34, speed: 115, glow: 22, label: true, gold: false },
  laggy: { animation: "stagger", status: "Working", size: 38, speed: 90, glow: 38, label: true, gold: true },
  executive: { animation: "heartbeat", status: "Working", size: 32, speed: 82, glow: 24, label: true, gold: true },
  dataRoom: { animation: "breach", status: "Reviewing files", size: 36, speed: 92, glow: 18, label: true, gold: false },
};

function apply() {
  const speed = Number(speedRange.value) / 100;
  const glow = Number(glowRange.value) / 100;

  chatWindow.dataset.animation = animationSelect.value;
  chatWindow.dataset.label = String(labelToggle.checked);
  chatWindow.dataset.gold = String(goldToggle.checked);
  chatWindow.style.setProperty("--activity-size", `${sizeRange.value}px`);
  chatWindow.style.setProperty("--activity-speed", String(speed));
  chatWindow.style.setProperty("--activity-glow", String(glow));

  for (const el of document.querySelectorAll(".status-text")) {
    el.textContent = statusSelect.value;
  }

  outputs.size.textContent = `${sizeRange.value}px`;
  outputs.speed.textContent = `${speed.toFixed(1)}×`;
  outputs.glow.textContent = `${glowRange.value}%`;
}

function applyPreset(name) {
  const preset = presets[name];
  if (!preset) return;
  animationSelect.value = preset.animation;
  statusSelect.value = preset.status;
  sizeRange.value = String(preset.size);
  speedRange.value = String(preset.speed);
  glowRange.value = String(preset.glow);
  labelToggle.checked = preset.label;
  goldToggle.checked = preset.gold;
  apply();
}

for (const control of [animationSelect, statusSelect, sizeRange, speedRange, glowRange, labelToggle, goldToggle]) {
  control.addEventListener("input", apply);
  control.addEventListener("change", apply);
}

for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
}

apply();
