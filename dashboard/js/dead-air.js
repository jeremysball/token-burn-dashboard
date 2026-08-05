// dashboard/js/dead-air.js
const HOUR_MS = 3600 * 1000;

/**
 * Detects runs of missing hourly buckets in an already hour-aggregated,
 * ascending-by-time series, e.g. the Timeline tab's `filtered` array.
 * @param {Array<{time: number}>} buckets sorted ascending by `time`
 * @param {number} [thresholdHours=3]
 * @returns {Array<{start: number, end: number}>}
 */
export function detectDeadAirBands(buckets, thresholdHours = 3) {
    if (!buckets || buckets.length < 2) return [];

    /** @type {Array<{start: number, end: number}>} */
    const bands = [];
    for (let i = 1; i < buckets.length; i++) {
        const prevTime = buckets[i - 1].time;
        const currTime = buckets[i].time;
        const missingHours = Math.round((currTime - prevTime) / HOUR_MS) - 1;
        if (missingHours >= thresholdHours) {
            bands.push({ start: prevTime + HOUR_MS, end: currTime });
        }
    }
    return bands;
}
