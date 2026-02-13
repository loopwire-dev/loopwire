#!/usr/bin/env python3
"""Generate an impossible torus (paradox) logo in OpenAI style.

Two thick elliptical rings cross at 4 points. At each crossing, one ring
goes "over" the other by leaving a gap in the "under" ring's path.
The over/under assignment alternates, creating the paradox illusion.

Output: a 24×24 SVG with filled path segments (no strokes).
"""

import math
import sys
from pathlib import Path

# ── Parameters ──────────────────────────────────────────────────────────
SIZE = 24
CX, CY = 12, 12

# Ellipse radii for the two bands (center-line of each annulus)
# Band A: horizontal-major (wider, tilted toward viewer)
A_RX, A_RY = 9.0, 5.5
# Band B: vertical-major (taller, tilted away)
B_RX, B_RY = 5.5, 9.0

# Thickness of each band (annulus inner-to-outer width)
THICKNESS = 2.2

# Extra gap margin in SVG units (adds visible space around each crossing)
GAP_MARGIN = 0.4

# Number of sample points per arc segment
ARC_SAMPLES = 60


# ── Geometry helpers ────────────────────────────────────────────────────

def ellipse_tangent_speed(rx, ry, t):
    """Speed (|tangent|) on ellipse at parameter t."""
    dx = -rx * math.sin(t)
    dy = ry * math.cos(t)
    return math.sqrt(dx * dx + dy * dy)


def ellipse_tangent(rx, ry, t):
    """Unit tangent vector on ellipse at parameter t."""
    dx = -rx * math.sin(t)
    dy = ry * math.cos(t)
    mag = math.sqrt(dx * dx + dy * dy)
    return (dx / mag, dy / mag)


def normalize_angle(a):
    """Normalize angle to [0, 2π)."""
    a = a % (2 * math.pi)
    if a < 0:
        a += 2 * math.pi
    return a


def find_crossings():
    """Find the 4 parameter pairs (ta, tb) where the two ellipses cross."""
    crossings = []
    N = 7200
    for i in range(N):
        ta = 2 * math.pi * i / N
        xa = A_RX * math.cos(ta)
        ya = A_RY * math.sin(ta)
        cb = xa / B_RX
        sb = ya / B_RY
        if abs(cb) > 1.0 or abs(sb) > 1.0:
            continue
        r2 = cb * cb + sb * sb
        if abs(r2 - 1.0) < 0.003:
            tb = math.atan2(sb, cb)
            # Deduplicate
            if not any(abs(ta - ta2) < 0.05 for ta2, _ in crossings):
                crossings.append((ta, tb))
    crossings.sort()
    return crossings


def crossing_gap_half(ta, tb, under_is_a):
    """Compute half-gap angle for the 'under' ring at a crossing.

    The gap must be wide enough so the under-ring's band doesn't poke
    through the over-ring's band.  We compute the angular extent of the
    over-ring's band along the under-ring's path.
    """
    # Tangent directions at crossing
    tA = ellipse_tangent(A_RX, A_RY, ta)
    tB = ellipse_tangent(B_RX, B_RY, tb)

    # Angle between the two tangent directions
    dot = abs(tA[0] * tB[0] + tA[1] * tB[1])
    cross_angle = math.acos(min(dot, 1.0))  # angle between tangents
    sin_cross = math.sin(cross_angle) if cross_angle > 0.01 else 0.01

    # Width of the over-ring projected across the under-ring's path
    projected_width = THICKNESS / sin_cross

    # Convert to angular gap on the under-ring
    if under_is_a:
        speed = ellipse_tangent_speed(A_RX, A_RY, ta)
    else:
        speed = ellipse_tangent_speed(B_RX, B_RY, tb)

    gap_half = (projected_width / 2 + GAP_MARGIN) / speed
    return gap_half


def arc_path_annulus(cx, cy, rx, ry, thickness, t_start, t_end, samples=60):
    """SVG path data for an annular arc segment (filled band)."""
    half = thickness / 2
    outer_rx, outer_ry = rx + half, ry + half
    inner_rx, inner_ry = rx - half, ry - half

    pts = []
    # Outer arc forward
    for i in range(samples + 1):
        t = t_start + (t_end - t_start) * i / samples
        pts.append((cx + outer_rx * math.cos(t), cy + outer_ry * math.sin(t)))
    # Inner arc reverse
    for i in range(samples + 1):
        t = t_end + (t_start - t_end) * i / samples
        pts.append((cx + inner_rx * math.cos(t), cy + inner_ry * math.sin(t)))

    d = f"M{pts[0][0]:.3f},{pts[0][1]:.3f}"
    for p in pts[1:]:
        d += f" L{p[0]:.3f},{p[1]:.3f}"
    d += "Z"
    return d


def generate_svg():
    crossings = find_crossings()
    assert len(crossings) == 4, f"Expected 4 crossings, got {len(crossings)}"

    # Over/under pattern (alternating):
    #   crossing 0: A on top  (gap in B)
    #   crossing 1: B on top  (gap in A)
    #   crossing 2: A on top  (gap in B)
    #   crossing 3: B on top  (gap in A)
    a_on_top = [True, False, True, False]

    # ── Compute per-crossing gap half-angles ──
    # For ring A: gaps at crossings where B is on top (indices 1, 3)
    # For ring B: gaps at crossings where A is on top (indices 0, 2)
    a_gap_halves = {}  # crossing_index -> gap_half for ring A
    b_gap_halves = {}  # crossing_index -> gap_half for ring B
    for ci, (ta, tb) in enumerate(crossings):
        if not a_on_top[ci]:  # B on top → gap in A
            a_gap_halves[ci] = crossing_gap_half(ta, tb, under_is_a=True)
        else:  # A on top → gap in B
            b_gap_halves[ci] = crossing_gap_half(ta, tb, under_is_a=False)

    # ── Build segments for Ring A ──
    a_cross_angles = [normalize_angle(ta) for ta, _ in crossings]
    # Sort crossing indices by their angle on ring A
    a_sorted = sorted(range(4), key=lambda k: a_cross_angles[k])

    a_segments = []
    for idx in range(4):
        ci_start = a_sorted[idx]
        ci_end = a_sorted[(idx + 1) % 4]
        t_start = a_cross_angles[ci_start]
        t_end = a_cross_angles[ci_end]
        if t_end <= t_start:
            t_end += 2 * math.pi

        # Apply gap at start crossing (if A goes under there)
        if ci_start in a_gap_halves:
            t_start += a_gap_halves[ci_start]
        # Apply gap at end crossing (if A goes under there)
        if ci_end in a_gap_halves:
            t_end -= a_gap_halves[ci_end]

        if t_end <= t_start:
            continue

        # Z-order: this segment goes "in front" if A is on top at the start crossing
        z = 2 if a_on_top[ci_start] else 0
        a_segments.append((t_start, t_end, z))

    # ── Build segments for Ring B ──
    b_cross_angles = [normalize_angle(tb) for _, tb in crossings]
    b_sorted = sorted(range(4), key=lambda k: b_cross_angles[k])

    b_segments = []
    for idx in range(4):
        ci_start = b_sorted[idx]
        ci_end = b_sorted[(idx + 1) % 4]
        t_start = b_cross_angles[ci_start]
        t_end = b_cross_angles[ci_end]
        if t_end <= t_start:
            t_end += 2 * math.pi

        if ci_start in b_gap_halves:
            t_start += b_gap_halves[ci_start]
        if ci_end in b_gap_halves:
            t_end -= b_gap_halves[ci_end]

        if t_end <= t_start:
            continue

        z = 0 if a_on_top[ci_start] else 2
        b_segments.append((t_start, t_end, z))

    # ── Generate paths ──
    all_paths = []
    for t_start, t_end, z in a_segments:
        d = arc_path_annulus(CX, CY, A_RX, A_RY, THICKNESS, t_start, t_end, ARC_SAMPLES)
        all_paths.append((z, d))
    for t_start, t_end, z in b_segments:
        d = arc_path_annulus(CX, CY, B_RX, B_RY, THICKNESS, t_start, t_end, ARC_SAMPLES)
        all_paths.append((z, d))

    # Sort: z=0 (behind) first, then z=2 (in front)
    all_paths.sort(key=lambda x: x[0])

    lines = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">',
    ]
    for z, d in all_paths:
        lines.append(f'  <path d="{d}" fill="#000000"/>')
    lines.append('</svg>')
    lines.append('')
    return '\n'.join(lines)


if __name__ == '__main__':
    svg = generate_svg()
    out = Path(__file__).parent.parent / 'apps' / 'web' / 'src' / 'assets' / 'images' / 'agent-codex-paradox.svg'
    out.write_text(svg)
    print(f"Wrote {out}", file=sys.stderr)
