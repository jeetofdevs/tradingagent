// Saves bot state as one JSON file. On Railway, mount a volume at DATA_DIR
// so history survives redeploys.

const fs = require('fs');
const path = require('path');

function createFileStore(dataDir) {
  const file = path.join(dataDir, 'state.json');
  return {
    file,
    load() {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') console.error(`Could not read ${file}, starting fresh:`, err.message);
        return null;
      }
    },
    save(state) {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, file); // atomic, so a crash never leaves half a file
    },
  };
}

function createMemoryStore() {
  let saved = null;
  return {
    load: () => (saved ? JSON.parse(saved) : null),
    save: (state) => {
      saved = JSON.stringify(state);
    },
  };
}

module.exports = { createFileStore, createMemoryStore };
