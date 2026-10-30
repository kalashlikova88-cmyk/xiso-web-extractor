class XISOParser {
  constructor(file, lang = "id") {
    this.file = file;
    this.rootOffset = 0;
    this.lang = lang;
  }

  async findHeader() {
    // 1. Cek semua offset partisi standar Xbox / Xbox 360 secara universal
    // (Header "MICROSOFT*XBOX*MEDIA" selalu berada di base_offset + 0x10000)
    const standardBaseOffsets = [
      0x00000000, // Format XISO Murni (Trimmed / Extracted XISO tanpa partisi video)
      0x02080000, // Standar Universal XGD3 (Semua game Xbox 360 rilisan ~2011 ke atas / 8.14 GB)
      0x0fd90000, // Standar Universal XGD2 (Semua game Xbox 360 Wave 3-12 standar / 7.29 GB)
      0x0fda0000, // Variasi XGD2 (Beberapa rilisan awal / hybrid disc)
      0x18300000, // Standar Universal XGD1 & Xbox 360 Wave 1-2 (Xbox Classic & rilisan awal 360)
    ];

    for (let baseOffset of standardBaseOffsets) {
      const headerOffset = baseOffset + 0x10000;
      if (await this.checkMagic(headerOffset, baseOffset)) {
        return await this.parseRoot(headerOffset, baseOffset);
      }
    }

    // 2. Fallback Deep Scan otomatis jika ISO menggunakan offset kustom / hasil modifikasi
    return await this.scanForHeader();
  }

  async checkMagic(headerOffset, baseOffset) {
    if (headerOffset + 2048 > this.file.size) return false;
    const buffer = await this.readBytes(headerOffset, 2048);
    const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 20));
    if (magic !== "MICROSOFT*XBOX*MEDIA") return false;

    // Validasi bahwa pointer root directory masuk akal dan berada di dalam batas file ISO
    const view = new DataView(buffer);
    const rootSector = view.getUint32(0x14, true);
    const rootSize = view.getUint32(0x18, true);
    const rootByteOffset = baseOffset + rootSector * 2048;

    return (
      rootSector > 0 &&
      rootSize > 0 &&
      rootByteOffset + rootSize <= this.file.size
    );
  }

  async parseRoot(headerOffset, baseOffset) {
    this.rootOffset = baseOffset; // HARUS Base offset partisi, bukan offset header
    const buffer = await this.readBytes(headerOffset, 2048);
    const view = new DataView(buffer);
    const rootSector = view.getUint32(0x14, true);
    const rootSize = view.getUint32(0x18, true);
    return { rootSector, rootSize, baseOffset };
  }

  async scanForHeader() {
    return new Promise(async (resolve, reject) => {
      // Scan hingga 500MB pertama untuk mencakup seluruh kemungkinan ukuran partisi Video
      const maxScan = Math.min(this.file.size, 500 * 1024 * 1024);
      const chunkSize = 10 * 1024 * 1024;
      const startScan = 0x10000;
      const magicBytes = [
        77, 73, 67, 82, 79, 83, 79, 70, 84, 42, 88, 66, 79, 88, 42, 77, 69, 68,
        73, 65,
      ];

      for (let i = startScan; i < maxScan; i += chunkSize) {
        const readSize = Math.min(chunkSize, maxScan - i);
        const buffer = await this.readBytes(i, readSize);
        const array = new Uint8Array(buffer);

        for (let j = 0; j <= array.length - 2048; j += 2048) {
          let match = true;
          for (let k = 0; k < 20; k++) {
            if (array[j + k] !== magicBytes[k]) {
              match = false;
              break;
            }
          }
          if (match) {
            const headerOffset = i + j;
            const baseOffset =
              headerOffset >= 0x10000 ? headerOffset - 0x10000 : 0;
            if (await this.checkMagic(headerOffset, baseOffset)) {
              const header = await this.parseRoot(headerOffset, baseOffset);
              resolve(header);
              return;
            }
          }
        }
      }
      reject(
        new Error(
          this.lang === "en"
            ? "Invalid ISO format. Game partition header not found."
            : "Format ISO tidak valid. Header partisi game tidak ditemukan.",
        ),
      );
    });
  }

  readBytes(offset, length) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const blob = this.file.slice(offset, offset + length);
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }

  async calculateTotalSize(sector, size) {
    let totalBytes = 0;
    let totalFiles = 0;

    const scanDir = async (dirSector, dirSize) => {
      if (dirSize <= 0) return;
      const byteOffset = this.rootOffset + dirSector * 2048;
      if (byteOffset + dirSize > this.file.size) return;

      const buffer = await this.readBytes(byteOffset, dirSize);
      const view = new DataView(buffer);
      const visited = new Set();

      const readNode = async (entryOffset) => {
        if (
          entryOffset < 0 ||
          entryOffset + 14 > dirSize ||
          visited.has(entryOffset)
        ) {
          return;
        }
        visited.add(entryOffset);

        const lIndex = view.getUint16(entryOffset, true);
        const rIndex = view.getUint16(entryOffset + 2, true);
        const startSector = view.getUint32(entryOffset + 4, true);
        const fileSize = view.getUint32(entryOffset + 8, true);
        const attributes = view.getUint8(entryOffset + 12);
        const nameLen = view.getUint8(entryOffset + 13);

        // Abaikan area padding sektor (0xFF) atau entry kosong
        if (
          nameLen === 0 ||
          nameLen === 0xff ||
          entryOffset + 14 + nameLen > dirSize ||
          startSector === 0xffffffff
        ) {
          return;
        }

        if (lIndex !== 0xffff && lIndex !== 0) await readNode(lIndex * 4);

        const isDirectory = (attributes & 0x10) !== 0;
        if (isDirectory) {
          if (startSector > 0 && fileSize > 0) {
            await scanDir(startSector, fileSize);
          }
        } else {
          totalBytes += fileSize;
          totalFiles += 1;
        }

        if (rIndex !== 0xffff && rIndex !== 0) await readNode(rIndex * 4);
      };

      await readNode(0);
    };

    await scanDir(sector, size);
    return { totalBytes, totalFiles };
  }

  async parseDirectory(sector, size, outputHandle, logCallback, progressCallback) {
    if (size <= 0) return;
    const byteOffset = this.rootOffset + sector * 2048;
    if (byteOffset + size > this.file.size) return;

    const buffer = await this.readBytes(byteOffset, size);
    const view = new DataView(buffer);
    const visited = new Set();

    // Algoritma Binary Tree untuk membaca file Xbox dengan akurat
    const readNode = async (entryOffset) => {
      if (
        entryOffset < 0 ||
        entryOffset + 14 > size ||
        visited.has(entryOffset)
      ) {
        return;
      }
      visited.add(entryOffset);

      const lIndex = view.getUint16(entryOffset, true);
      const rIndex = view.getUint16(entryOffset + 2, true);
      const startSector = view.getUint32(entryOffset + 4, true);
      const fileSize = view.getUint32(entryOffset + 8, true);
      const attributes = view.getUint8(entryOffset + 12);
      const nameLen = view.getUint8(entryOffset + 13);

      // Abaikan area padding sektor (0xFF) atau entry kosong
      if (
        nameLen === 0 ||
        nameLen === 0xff ||
        entryOffset + 14 + nameLen > size ||
        startSector === 0xffffffff
      ) {
        return;
      }

      // 1. Traverse Kiri
      if (lIndex !== 0xffff && lIndex !== 0) await readNode(lIndex * 4);

      // 2. Ekstrak Node Saat Ini
      let name = "";
      for (let i = 0; i < nameLen; i++) {
        name += String.fromCharCode(view.getUint8(entryOffset + 14 + i));
      }

      // Sanitasi (Mencegah karakter aneh merusak ChromeOS / OS File System)
      name = name.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "_").trim();
      const isDirectory = (attributes & 0x10) !== 0;

      if (name !== "") {
        if (isDirectory) {
          if (startSector > 0 && fileSize > 0) {
            logCallback(
              this.lang === "en"
                ? `&#128193; Creating Folder: ${name}`
                : `&#128193; Membuat Folder: ${name}`,
            );
            const newDirHandle = await outputHandle.getDirectoryHandle(name, {
              create: true,
            });
            await this.parseDirectory(
              startSector,
              fileSize,
              newDirHandle,
              logCallback,
              progressCallback,
            );
          }
        } else {
          logCallback(
            this.lang === "en"
              ? `&#128196; Extracting: ${name} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`
              : `&#128196; Mengekstrak: ${name} (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`,
          );
          await this.extractFile(
            startSector,
            fileSize,
            name,
            outputHandle,
            progressCallback,
          );
        }
      }

      // 3. Traverse Kanan
      if (rIndex !== 0xffff && rIndex !== 0) await readNode(rIndex * 4);
    };

    await readNode(0);
  }

  async extractFile(startSector, fileSize, fileName, dirHandle, progressCallback) {
    const fileHandle = await dirHandle.getFileHandle(fileName, {
      create: true,
    });
    const writable = await fileHandle.createWritable();

    const fileOffset = this.rootOffset + startSector * 2048;
    const chunkSize = 2 * 1024 * 1024;

    let readBytesCount = 0;
    while (readBytesCount < fileSize) {
      const currentChunkSize = Math.min(chunkSize, fileSize - readBytesCount);
      const buffer = await this.readBytes(
        fileOffset + readBytesCount,
        currentChunkSize,
      );
      await writable.write(buffer);
      readBytesCount += currentChunkSize;
      if (progressCallback) {
        progressCallback(currentChunkSize);
      }
    }

    await writable.close();
  }
}
