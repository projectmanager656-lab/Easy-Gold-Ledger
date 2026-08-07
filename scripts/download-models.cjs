const fs = require('fs');
const path = require('path');
const https = require('https');

const MODEL_DIR = path.join(__dirname, '..', 'public', 'models');
const BASE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

const files = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1'
];

if (!fs.existsSync(MODEL_DIR)) {
  fs.mkdirSync(MODEL_DIR, { recursive: true });
}

function downloadFile(fileName) {
  const fileUrl = `${BASE_URL}${fileName}`;
  const filePath = path.join(MODEL_DIR, fileName);

  return new Promise((resolve, reject) => {
    console.log(`Downloading ${fileName}...`);
    https.get(fileUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${fileUrl}' (${response.statusCode})`));
        return;
      }

      const fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Downloaded ${fileName} successfully.`);
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filePath, () => {}); // Delete file on error
      reject(err);
    });
  });
}

async function main() {
  console.log(`Target directory: ${MODEL_DIR}`);
  for (const file of files) {
    try {
      await downloadFile(file);
    } catch (err) {
      console.error(`Error downloading ${file}:`, err.message);
      process.exit(1);
    }
  }
  console.log('All face models downloaded successfully!');
}

main();
