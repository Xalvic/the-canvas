export const MIN_IMAGE_SIZE = 32;

export function getProportionalImageSize(
  startWidth: number,
  startHeight: number,
  deltaX: number,
  deltaY: number,
): { width: number; height: number } {
  const widthScale = (startWidth + deltaX) / startWidth;
  const heightScale = (startHeight + deltaY) / startHeight;
  const requestedScale = Math.abs(widthScale - 1) > Math.abs(heightScale - 1)
    ? widthScale
    : heightScale;
  const minimumScale = Math.max(
    MIN_IMAGE_SIZE / startWidth,
    MIN_IMAGE_SIZE / startHeight,
  );
  const scale = Math.max(minimumScale, requestedScale);
  return {
    width: startWidth * scale,
    height: startHeight * scale,
  };
}
