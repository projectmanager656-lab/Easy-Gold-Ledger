import * as faceapi from '@vladmandic/face-api';

let modelsLoaded = false;

/**
 * Loads the face-api models from the public folder.
 * Keeps track of load status to prevent reloading.
 */
export async function loadFaceModels() {
  if (modelsLoaded) return true;
  try {
    const MODEL_URL = '/models';
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]);
    modelsLoaded = true;
    console.log('Face verification models loaded successfully.');
    return true;
  } catch (error) {
    console.error('Failed to load face verification models:', error);
    throw error;
  }
}

/**
 * Detects a face and extracts its descriptor embedding.
 * 
 * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement} element - HTML element containing the face
 * @returns {Promise<number[]|null>} Resolves to a 128-dimensional face descriptor array, or null if no face detected
 */
export async function getFaceDescriptor(element) {
  await loadFaceModels();
  try {
    const detection = await faceapi
      .detectSingleFace(element, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      return null;
    }

    // Convert Float32Array to standard number array for Firestore compatibility
    return Array.from(detection.descriptor);
  } catch (error) {
    console.error('Error generating face descriptor:', error);
    return null;
  }
}

/**
 * Calculates Euclidean distance between two face descriptors to verify a match.
 * 
 * @param {number[]} desc1 - First face descriptor array
 * @param {number[]} desc2 - Second face descriptor array
 * @param {number} threshold - Match threshold (standard is 0.6; lower is stricter)
 * @returns {Object} { isMatch: boolean, distance: number }
 */
export function verifyFaceMatch(desc1, desc2, threshold = 0.6) {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) {
    return { isMatch: false, distance: 1.0 };
  }

  // Calculate Euclidean Distance manually for robust client-side validation
  const distance = Math.sqrt(
    desc1.reduce((sum, val, idx) => sum + Math.pow(val - desc2[idx], 2), 0)
  );

  return {
    isMatch: distance <= threshold,
    distance: Math.round(distance * 1000) / 1000
  };
}
