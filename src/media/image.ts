import type { SourceMedia } from '../model/types';

export function loadImage(file: File): Promise<SourceMedia> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        type: 'image',
        name: file.name,
        width: img.naturalWidth,
        height: img.naturalHeight,
        element: img,
      });
    };
    img.onerror = () => reject(new Error(`Failed to load image: ${file.name}`));
    img.src = url;
  });
}
