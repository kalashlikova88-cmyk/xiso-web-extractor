// Hilangkan /index.html dari address bar (baik di Chrome Extension maupun Web Server)
if (window.location.pathname.endsWith("/index.html")) {
  const cleanPath =
    window.location.protocol === "chrome-extension:"
      ? "/xiso-web-extractor"
      : window.location.pathname.replace(/index\.html$/, "");
  window.history.replaceState(null, "", cleanPath);
}

let selectedFiles = [];
let currentLang = localStorage.getItem("xiso_lang") || "id";

const isoInput = document.getElementById("isoInput");
const btnExtract = document.getElementById("btnExtract");
const logDiv = document.getElementById("log");
const progressText = document.getElementById("progress");
const progressBar = document.getElementById("progressBar");

const titleText = document.getElementById("titleText");
const descText = document.getElementById("descText");
const labelStep1 = document.getElementById("labelStep1");
const labelStep2 = document.getElementById("labelStep2");
const btnLangId = document.getElementById("btnLangId");
const btnLangEn = document.getElementById("btnLangEn");

const i18n = {
  id: {
    title: "Xbox 360 ISO Extractor",
    desc: "Pilih file .ISO game Xbox 360 dan folder tujuan di Perangkat Anda.",
    step1: "1. Pilih File ISO Xbox 360 (Bisa lebih dari 1):",
    step2: "2. Ekstrak ke Folder:",
    btnExtract: "Pilih Folder & Ekstrak Game",
    waitingIso: "Status: Menunggu file ISO...",
    filesSelected: (count) => `Status: ${count} file ISO dipilih.`,
    processingIso: (num, total, name) =>
      `<br><b>=== [${num}/${total}] Memproses: ${name} ===</b>`,
    creatingMainFolder: (folder) => `Membuat folder utama: /${folder}`,
    analyzingHeader: "Menganalisis header & menghitung ukuran file dalam ISO...",
    partitionOffset: (hex) => `Base Offset Partisi ditemukan: 0x${hex}`,
    foundFiles: (count, size) =>
      `Ditemukan ${count} file dengan total ukuran ${size}.`,
    startExtraction: "Memulai proses ekstraksi game...",
    doneIso: (folder) => `<b>Selesai mengekstrak: ${folder}</b>`,
    allDoneLog: "<br><b>SEMUA EKSTRAKSI SELESAI!</b>",
    allDoneProgress: (total) =>
      `Selesai! (${total} ISO berhasil diekstrak - 100%)`,
  },
  en: {
    title: "Xbox 360 ISO Extractor",
    desc: "Select Xbox 360 game .ISO file(s) and destination folder on your device.",
    step1: "1. Select Xbox 360 ISO File(s) (Multiple allowed):",
    step2: "2. Extract to Folder:",
    btnExtract: "Select Folder & Extract Game",
    waitingIso: "Status: Waiting for ISO file...",
    filesSelected: (count) => `Status: ${count} ISO file(s) selected.`,
    processingIso: (num, total, name) =>
      `<br><b>=== [${num}/${total}] Processing: ${name} ===</b>`,
    creatingMainFolder: (folder) => `Creating main folder: /${folder}`,
    analyzingHeader: "Analyzing header & calculating file sizes inside ISO...",
    partitionOffset: (hex) => `Partition Base Offset found: 0x${hex}`,
    foundFiles: (count, size) =>
      `Found ${count} file(s) with total size ${size}.`,
    startExtraction: "Starting game extraction process...",
    doneIso: (folder) => `<b>Finished extracting: ${folder}</b>`,
    allDoneLog: "<br><b>ALL EXTRACTIONS COMPLETED!</b>",
    allDoneProgress: (total) =>
      `Done! (${total} ISO(s) extracted successfully - 100%)`,
  },
};

function applyLanguage(lang) {
  currentLang = lang;
  localStorage.setItem("xiso_lang", lang);
  document.documentElement.lang = lang;

  const t = i18n[lang];
  if (titleText) titleText.textContent = t.title;
  if (descText) descText.textContent = t.desc;
  if (labelStep1) labelStep1.textContent = t.step1;
  if (labelStep2) labelStep2.textContent = t.step2;
  if (btnExtract) btnExtract.textContent = t.btnExtract;

  if (btnLangId) btnLangId.classList.toggle("active", lang === "id");
  if (btnLangEn) btnLangEn.classList.toggle("active", lang === "en");

  if (selectedFiles.length === 0) {
    logDiv.innerHTML = t.waitingIso;
  } else if (!isoInput.disabled) {
    logDiv.innerHTML = `<div>${t.filesSelected(selectedFiles.length)}</div>`;
    selectedFiles.forEach((file, idx) => {
      log(`${idx + 1}. ${file.name} (${formatSize(file.size)})`);
    });
  }
}

if (btnLangId) {
  btnLangId.addEventListener("click", () => applyLanguage("id"));
}
if (btnLangEn) {
  btnLangEn.addEventListener("click", () => applyLanguage("en"));
}

function log(msg) {
  logDiv.innerHTML += `<div>> ${msg}</div>`;
  logDiv.scrollTop = logDiv.scrollHeight;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function updateProgressUI(extractedBytes, totalBytes, currentIsoIndex, totalIsos) {
  const percent =
    totalBytes > 0 ? Math.min(100, (extractedBytes / totalBytes) * 100) : 0;
  const prefix =
    totalIsos > 1 ? `[ISO ${currentIsoIndex}/${totalIsos}] ` : "";

  if (progressBar) {
    progressBar.style.width = `${percent.toFixed(1)}%`;
  }
  if (progressText) {
    progressText.textContent = `${prefix}Progress: ${percent.toFixed(1)}% (${formatSize(extractedBytes)} / ${formatSize(totalBytes)})`;
  }
}

isoInput.addEventListener("change", (e) => {
  selectedFiles = Array.from(e.target.files);
  const t = i18n[currentLang];
  if (selectedFiles.length > 0) {
    btnExtract.disabled = false;
    logDiv.innerHTML = `<div>${t.filesSelected(selectedFiles.length)}</div>`;
    selectedFiles.forEach((file, idx) => {
      log(`${idx + 1}. ${file.name} (${formatSize(file.size)})`);
    });
    if (progressBar) progressBar.style.width = "0%";
    if (progressText) progressText.textContent = "Progress: 0%";
  } else {
    btnExtract.disabled = true;
    logDiv.innerHTML = t.waitingIso;
  }
});

btnExtract.addEventListener("click", async () => {
  if (selectedFiles.length === 0) return;

  try {
    // Meminta izin "readwrite" untuk folder tujuan utama sekali saja
    const dirHandle = await window.showDirectoryPicker({
      mode: "readwrite",
    });

    btnExtract.disabled = true;
    isoInput.disabled = true;

    const totalIsos = selectedFiles.length;

    for (let i = 0; i < totalIsos; i++) {
      const currentFile = selectedFiles[i];
      const isoNumber = i + 1;
      const folderName = currentFile.name.replace(/\.[^/.]+$/, "");
      const t = i18n[currentLang];

      log(t.processingIso(isoNumber, totalIsos, currentFile.name));
      log(t.creatingMainFolder(folderName));

      const gameDirHandle = await dirHandle.getDirectoryHandle(folderName, {
        create: true,
      });

      log(t.analyzingHeader);
      const parser = new XISOParser(currentFile, currentLang);
      const header = await parser.findHeader();

      log(t.partitionOffset(header.baseOffset.toString(16)));

      const { totalBytes, totalFiles } = await parser.calculateTotalSize(
        header.rootSector,
        header.rootSize,
      );
      log(t.foundFiles(totalFiles, formatSize(totalBytes)));
      log(t.startExtraction);

      let extractedBytes = 0;
      updateProgressUI(0, totalBytes, isoNumber, totalIsos);

      await parser.parseDirectory(
        header.rootSector,
        header.rootSize,
        gameDirHandle,
        log,
        (chunkBytes) => {
          extractedBytes += chunkBytes;
          updateProgressUI(extractedBytes, totalBytes, isoNumber, totalIsos);
        },
      );

      updateProgressUI(totalBytes, totalBytes, isoNumber, totalIsos);
      log(t.doneIso(folderName));
    }

    const t = i18n[currentLang];
    log(t.allDoneLog);
    if (progressText) {
      progressText.textContent = t.allDoneProgress(totalIsos);
    }
  } catch (err) {
    log(`ERROR: ${err.message}`);
  } finally {
    btnExtract.disabled = false;
    isoInput.disabled = false;
  }
});

applyLanguage(currentLang);
