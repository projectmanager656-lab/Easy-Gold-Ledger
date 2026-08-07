/**
 * Utility to compress images client-side before uploading as Base64 to Firestore.
 * Resizes the image to have a maximum dimension of `maxDimension` (default 800px)
 * and compresses it with a JPEG quality factor (default 0.6).
 *
 * @param {File|Blob|string} imageInput - File object, Blob, or existing Base64 string
 * @param {number} maxDimension - Maximum width or height of the output image in pixels
 * @param {number} quality - Compression quality from 0.1 to 1.0
 * @returns {Promise<string>} Promise resolving to the compressed JPEG Base64 string (including data prefix)
 */
export function compressImage(imageInput, maxDimension = 800, quality = 0.6) {
  return new Promise((resolve, reject) => {
    let img = new Image();

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Calculate new dimensions keeping aspect ratio
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get 2D context from canvas'));
        return;
      }

      // Draw image on canvas
      ctx.drawImage(img, 0, 0, width, height);

      // Export as compressed JPEG base64 string
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      
      // Basic size validation
      const approximateSizeKb = (compressedDataUrl.length * 3) / 4 / 1024;
      if (approximateSizeKb > 300) {
        console.warn(`Compressed image is ${approximateSizeKb.toFixed(1)}KB, which exceeds target 300KB. Attempting higher compression.`);
        // Try compressing with lower quality if still above 300KB
        const higherCompressed = canvas.toDataURL('image/jpeg', Math.max(0.3, quality - 0.2));
        resolve(higherCompressed);
      } else {
        resolve(compressedDataUrl);
      }
    };

    img.onerror = (err) => {
      reject(new Error('Failed to load image for compression: ' + err.message));
    };

    if (imageInput instanceof File || imageInput instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target && e.target.result) {
          img.src = e.target.result.toString();
        } else {
          reject(new Error('FileReader target result is empty'));
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(imageInput);
    } else if (typeof imageInput === 'string') {
      img.src = imageInput;
    } else {
      reject(new Error('Invalid image input type. Expected File, Blob, or base64 string.'));
    }
  });
}

/**
 * Draws a professional GPS Map Camera style watermark banner on top of the image canvas.
 * Watermarks display the human-readable address, latitude, longitude, and current timestamp.
 */
export async function drawGpsWatermark(imageBase64, latitude, longitude, addressText = '') {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = imageBase64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      
      // Draw original image
      ctx.drawImage(img, 0, 0);
      
      // Calculate responsive layout dimensions
      const boxHeight = Math.max(100, Math.floor(img.height * 0.25));
      
      // Draw dark semi-transparent banner box at the bottom
      ctx.fillStyle = 'rgba(10, 14, 23, 0.82)';
      ctx.fillRect(0, img.height - boxHeight, img.width, boxHeight);
      
      // Gold separation border line
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = Math.max(2, Math.floor(img.height * 0.005));
      ctx.beginPath();
      ctx.moveTo(0, img.height - boxHeight);
      ctx.lineTo(img.width, img.height - boxHeight);
      ctx.stroke();
      
      // Render text details
      const fontSize = Math.max(11, Math.floor(img.height * 0.032));
      ctx.fillStyle = '#f8fafc';
      ctx.font = `600 ${fontSize}px Montserrat, Mukta, sans-serif`;
      
      const paddingX = Math.max(12, Math.floor(img.width * 0.04));
      let startY = img.height - boxHeight + fontSize + 12;
      const lineHeight = fontSize + Math.max(4, Math.floor(fontSize * 0.3));
      
      // 1. Header Section
      ctx.fillStyle = '#d4af37';
      ctx.fillText('📍 GPS MAP SECURITY CAMERA', paddingX, startY);
      startY += lineHeight;
      
      // 2. Address Lines (split to wrap within the canvas width)
      ctx.fillStyle = '#f8fafc';
      const maxTextWidth = img.width - (paddingX * 2);
      const addressLines = [];
      const words = (addressText || 'Fetching precise location address...').split(' ');
      let currentLine = '';
      
      words.forEach(word => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTextWidth) {
          addressLines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });
      if (currentLine) addressLines.push(currentLine);
      
      // Limit to 2 lines of address to avoid overflow
      addressLines.slice(0, 2).forEach(line => {
        ctx.fillText(line, paddingX, startY);
        startY += lineHeight;
      });
      
      // 3. Latitude & Longitude Coordinates
      ctx.fillStyle = '#94a3b8';
      if (latitude !== 0 || longitude !== 0) {
        ctx.fillText(`Lat: ${latitude.toFixed(6)}, Long: ${longitude.toFixed(6)}`, paddingX, startY);
      } else {
        ctx.fillText('GPS Coordinates: Blocked/Unavailable', paddingX, startY);
      }
      startY += lineHeight;
      
      // 4. Formatted Date & Time Stamp
      const dateString = new Date().toLocaleString('en-IN', {
        weekday: 'long',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      ctx.fillText(dateString, paddingX, startY);
      
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      resolve(imageBase64); // Fallback to raw image on load failure
    };
  });
}
