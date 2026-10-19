export const NEAR_BOTTOM_THRESHOLD = 80;

export interface ScrollMetrics {
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
}

export function distanceFromBottom({ contentHeight, viewportHeight, offsetY }: ScrollMetrics): number {
  return Math.max(0, contentHeight - viewportHeight - offsetY);
}

export function isNearBottom(metrics: ScrollMetrics, threshold = NEAR_BOTTOM_THRESHOLD): boolean {
  return distanceFromBottom(metrics) <= threshold;
}

/** Follow new content only when the reader is already at (or near) the end. */
export function shouldFollowContent(nearBottom: boolean): boolean {
  return nearBottom;
}

/** Show the "Latest" button when the reader has scrolled away from the end. */
export function shouldShowLatest(nearBottom: boolean, hasContent: boolean): boolean {
  return hasContent && !nearBottom;
}
