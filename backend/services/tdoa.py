"""
services/tdoa.py — NICU Guardian (Feature 6)

3-microphone Time-Difference-Of-Arrival (TDOA) sound source localisation.

Given 3 microphone positions and their RMS signal levels (or raw waveforms),
estimates the (x, y) position of the dominant sound source in the ward.

Method:
  - Primary: Cross-correlation between mic pairs to find time delays,
    then multilateration using the speed of sound.
  - Fallback: If only RMS levels are available (no raw waveforms),
    use power-weighted centroid of mic positions.

The identified bay gets a pulsing ring on the IncubatorMap component.
"""

import numpy as np
from typing import List, Tuple, Optional

SPEED_OF_SOUND = 343.0  # m/s at ~20°C


# ── Ward layout (default 6-bay NICU) ─────────────────────────────────────────

DEFAULT_MIC_POSITIONS = [
    (0.0, 0.0, 2.5),   # Mic 0: top-left corner, ceiling mounted
    (6.0, 0.0, 2.5),   # Mic 1: top-right corner
    (3.0, 5.0, 2.5),   # Mic 2: bottom-center
]

DEFAULT_BAY_POSITIONS = {
    "BAY_01": (1.0, 1.5),
    "BAY_02": (3.0, 1.5),
    "BAY_03": (5.0, 1.5),
    "BAY_04": (1.0, 3.5),
    "BAY_05": (3.0, 3.5),
    "BAY_06": (5.0, 3.5),
}


# ── Cross-correlation TDOA ───────────────────────────────────────────────────

def cross_correlate_delay(
    signal_a: np.ndarray,
    signal_b: np.ndarray,
    sample_rate: int = 16000,
) -> float:
    """
    Compute the time delay between two signals using cross-correlation.

    Returns the delay in seconds (positive = b arrives after a).
    """
    if len(signal_a) == 0 or len(signal_b) == 0:
        return 0.0

    # Normalise signals
    a = signal_a - np.mean(signal_a)
    b = signal_b - np.mean(signal_b)

    # Cross-correlate
    correlation = np.correlate(a, b, mode='full')
    mid = len(a) - 1
    lag = np.argmax(correlation) - mid

    return lag / sample_rate


def tdoa_locate_signals(
    mic_positions: List[Tuple[float, float, float]],
    signals: List[np.ndarray],
    sample_rate: int = 16000,
) -> Tuple[float, float]:
    """
    Full TDOA localisation using cross-correlation on raw waveforms.

    Parameters
    ----------
    mic_positions : list of (x, y, z) tuples for each mic
    signals       : list of numpy arrays (one waveform per mic)
    sample_rate   : audio sample rate in Hz

    Returns
    -------
    (x, y) estimated position of the sound source
    """
    if len(mic_positions) < 3 or len(signals) < 3:
        return tdoa_locate_rms(mic_positions, [float(np.sqrt(np.mean(s**2))) for s in signals])

    # Compute time delays between mic pairs
    # Pair (0,1), (0,2), (1,2)
    pairs = [(0, 1), (0, 2), (1, 2)]
    delays = []
    for i, j in pairs:
        delay = cross_correlate_delay(signals[i], signals[j], sample_rate)
        delays.append(delay)

    # Convert delays to distance differences
    dist_diffs = [d * SPEED_OF_SOUND for d in delays]

    # Multilateration using least-squares (linearised hyperbolic equations)
    # For a 2D solution with 3 mics:
    try:
        x0, y0, _ = mic_positions[0]
        x1, y1, _ = mic_positions[1]
        x2, y2, _ = mic_positions[2]

        # Set up the system of equations
        # Using mic 0 as reference
        d01 = dist_diffs[0]  # distance diff between mic0 and mic1
        d02 = dist_diffs[1]  # distance diff between mic0 and mic2

        # Linearised form: Ax = b
        A = np.array([
            [2 * (x1 - x0), 2 * (y1 - y0)],
            [2 * (x2 - x0), 2 * (y2 - y0)],
        ])

        b = np.array([
            (x1**2 - x0**2) + (y1**2 - y0**2) - d01**2,
            (x2**2 - x0**2) + (y2**2 - y0**2) - d02**2,
        ])

        # Solve via least squares
        result, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
        x_est, y_est = float(result[0]), float(result[1])

        # Clamp to reasonable ward bounds
        x_est = max(0, min(8, x_est))
        y_est = max(0, min(6, y_est))

        return (round(x_est, 2), round(y_est, 2))

    except (np.linalg.LinAlgError, ValueError):
        # Fallback to RMS-weighted centroid
        rms_levels = [float(np.sqrt(np.mean(s**2))) for s in signals]
        return tdoa_locate_rms(mic_positions, rms_levels)


# ── RMS-weighted fallback ────────────────────────────────────────────────────

def tdoa_locate_rms(
    mic_positions: List[Tuple[float, float, float]],
    mic_rms: List[float],
) -> Tuple[float, float]:
    """
    Fallback TDOA: power-weighted centroid of mic positions.
    Used when raw waveforms are not available (only RMS levels from each mic).
    """
    if not mic_rms or not mic_positions:
        return (0.0, 0.0)

    # Square the RMS values to get power weights
    powers = np.array([r ** 2 for r in mic_rms])
    total_power = powers.sum()

    if total_power < 1e-10:
        # All silent — return center of mic array
        xs = [p[0] for p in mic_positions]
        ys = [p[1] for p in mic_positions]
        return (round(np.mean(xs), 2), round(np.mean(ys), 2))

    # Weighted centroid
    x = sum(p[0] * w for p, w in zip(mic_positions, powers)) / total_power
    y = sum(p[1] * w for p, w in zip(mic_positions, powers)) / total_power

    return (round(x, 2), round(y, 2))


# ── Convenience: find nearest bay ────────────────────────────────────────────

def nearest_bay(
    position: Tuple[float, float],
    bay_positions: dict = None,
) -> str:
    """
    Given an (x, y) TDOA position, return the ID of the nearest incubator bay.
    """
    bays = bay_positions or DEFAULT_BAY_POSITIONS
    if not bays:
        return "BAY_UNKNOWN"

    best_bay = None
    best_dist = float('inf')

    for bay_id, (bx, by) in bays.items():
        dist = np.sqrt((position[0] - bx) ** 2 + (position[1] - by) ** 2)
        if dist < best_dist:
            best_dist = dist
            best_bay = bay_id

    return best_bay


# ── Legacy API (backward compatible) ────────────────────────────────────────

def tdoa_locate(
    mic_positions: List[Tuple[float, float, float]],
    mic_rms: List[float],
    sample_rate: int = 16000,
) -> Tuple[float, float]:
    """
    Original API — accepts RMS levels only.
    Returns (x, y) position of the estimated sound source.
    """
    return tdoa_locate_rms(mic_positions, mic_rms)
