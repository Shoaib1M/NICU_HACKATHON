"""
services/tdoa.py — NICU Guardian (Feature 6)
3-microphone Time-Difference-Of-Arrival sound source localisation.
TODO: implement in Phase 3 (TDOA build step)

Given 3 mic positions and per-channel RMS levels, returns the
(x, y) estimate of the loudest sound source in the ward.
"""
import numpy as np
from typing import List, Tuple

SPEED_OF_SOUND = 343.0  # m/s at 20°C

def tdoa_locate(
    mic_positions: List[Tuple[float, float, float]],
    mic_rms:       List[float],
    sample_rate:   int = 16000,
) -> Tuple[float, float]:
    """
    Placeholder TDOA implementation.
    Returns the position of the mic with the highest RMS as a rough estimate
    until the full cross-correlation method is implemented.
    """
    if not mic_rms:
        return (0.0, 0.0)
    loudest = int(np.argmax(mic_rms))
    x, y, _ = mic_positions[loudest]
    return (round(x, 2), round(y, 2))
