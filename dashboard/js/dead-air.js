// dashboard/js/dead-air.js
const HOUR_MS = 3600 * 1000;

/** @param {*} buckets @param {number|undefined} chartEnd @returns {boolean} */
const hasValidHourlyInput = (buckets, chartEnd) => {
    if (!Array.isArray(buckets)) return false;
    if (chartEnd !== undefined && (!Number.isFinite(chartEnd) || chartEnd % HOUR_MS !== 0)) return false;
    return buckets.every((bucket, index) => {
        const time = bucket?.time;
        return Number.isFinite(time) && time % HOUR_MS === 0 && (index === 0 || time > buckets[index - 1].time);
    });
};

/** @param {Array<{time: number}>} buckets @param {number} thresholdHours @returns {Array<{start: number, end: number}>} */
const detectInternalBands = (buckets, thresholdHours) => {
    /** @type {Array<{start: number, end: number}>} */
    const bands = [];
    for (let i = 1; i < buckets.length; i++) {
        const prevTime = buckets[i - 1].time;
        const currTime = buckets[i].time;
        const missingHours = (currTime - prevTime) / HOUR_MS - 1;
        if (missingHours >= thresholdHours) bands.push({ start: prevTime + HOUR_MS, end: currTime });
    }
    return bands;
};

/**
 * Detects runs of missing hourly buckets in an already hour-aggregated,
 * ascending-by-time series, e.g. the Timeline tab's `filtered` array.
 * @param {Array<{time: number}>} buckets sorted ascending by `time`
 * @param {number} [thresholdHours=3]
 * @param {number} [chartEnd]
 * @returns {Array<{start: number, end: number}>}
 */
export function detectDeadAirBands(buckets, thresholdHours = 3, chartEnd = undefined) {
    if (!Number.isFinite(thresholdHours) || thresholdHours <= 0 || !hasValidHourlyInput(buckets, chartEnd) || buckets.length === 0) return [];

    const bands = detectInternalBands(buckets, thresholdHours);

    const lastTime = buckets[buckets.length - 1].time;
    if (chartEnd !== undefined && chartEnd > lastTime) {
        const missingHours = (chartEnd - lastTime) / HOUR_MS - 1;
        if (missingHours >= thresholdHours) {
            bands.push({ start: lastTime + HOUR_MS, end: chartEnd });
        }
    }

    return bands;
}
