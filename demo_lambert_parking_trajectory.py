#!/usr/bin/env python3

from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Sequence, Tuple

Vec2 = Tuple[float, float]
Vec3 = Tuple[float, float, float]


def v2_add(a: Vec2, b: Vec2) -> Vec2:
    return (a[0] + b[0], a[1] + b[1])


def v2_mul(a: Vec2, s: float) -> Vec2:
    return (a[0] * s, a[1] * s)


def v2_dot(a: Vec2, b: Vec2) -> float:
    return a[0] * b[0] + a[1] * b[1]


def v2_len(a: Vec2) -> float:
    return math.hypot(a[0], a[1])


def v2_unit(a: Vec2) -> Vec2:
    n = v2_len(a)
    if n == 0:
        return (1.0, 0.0)
    return (a[0] / n, a[1] / n)


def v3_xy(p: Vec3) -> Vec2:
    return (p[0], p[1])


def v3_dist(a: Vec3, b: Vec3) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    dz = a[2] - b[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def dir_xy(p0: Vec3, p1: Vec3) -> Vec2:
    d = (p1[0] - p0[0], p1[1] - p0[1])
    n = v2_len(d)
    if n == 0:
        return (0.0, 0.0)
    return (d[0] / n, d[1] / n)


def angle_between_deg(a: Vec2, b: Vec2) -> float:
    if (a[0] == 0.0 and a[1] == 0.0) or (b[0] == 0.0 and b[1] == 0.0):
        return float("nan")
    dot = v2_dot(a, b)
    dot = max(-1.0, min(1.0, dot))
    return math.degrees(math.acos(dot))


def catmull_rom_spline_path(points_xy: List[Vec2]) -> str:
    if len(points_xy) < 2:
        return ""

    pts = points_xy
    padded = [pts[0]] + pts + [pts[-1]]

    d: List[str] = [f"M {pts[0][0]:.2f} {pts[0][1]:.2f}"]
    for k in range(len(pts) - 1):
        p0 = padded[k]
        p1 = padded[k + 1]
        p2 = padded[k + 2]
        p3 = padded[k + 3]

        c1 = (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0)
        d.append(
            f"C {c1[0]:.2f} {c1[1]:.2f} {c2[0]:.2f} {c2[1]:.2f} {p2[0]:.2f} {p2[1]:.2f}"
        )

    return " ".join(d)


def build_samples_by_count(pos_fn: Callable[[float], Vec3], t0: float, t1: float, *, n: int) -> List[Tuple[float, Vec3]]:
    steps = max(2, int(n))
    a = float(t0)
    b = float(t1)
    if b < a:
        a, b = b, a

    dt = max(1e-9, b - a)
    out: List[Tuple[float, Vec3]] = []
    for i in range(steps):
        s = i / (steps - 1)
        t = a + dt * s
        out.append((t, pos_fn(t)))
    return out


def build_samples_by_dt(pos_fn: Callable[[float], Vec3], t0: float, t1: float, *, dt_days: float) -> List[Tuple[float, Vec3]]:
    dt = float(max(1e-9, dt_days))
    a = float(t0)
    b = float(t1)
    if b < a:
        a, b = b, a

    samples: List[Tuple[float, Vec3]] = []
    t = a
    while t <= b + 1e-9:
        samples.append((t, pos_fn(t)))
        t += dt

    if not samples or samples[-1][0] < b - 1e-9:
        samples.append((b, pos_fn(b)))

    return samples


@dataclass(frozen=True)
class DistanceReport:
    ok: bool
    min_d_earth: float
    t_min_earth: float
    min_d_mars: float
    t_min_mars: float
    first_violation: str | None


def check_no_penetration(engine, r_excl_earth: float, r_excl_mars: float, samples: Sequence[Tuple[float, Vec3]]) -> DistanceReport:
    min_d_earth = float("inf")
    min_d_mars = float("inf")
    t_min_earth = float("nan")
    t_min_mars = float("nan")

    ok = True
    first_violation: str | None = None

    for t, ship in samples:
        earth = engine.get_planet_position("earth", t)
        mars = engine.get_planet_position("mars", t)

        de = v3_dist(ship, earth)
        dm = v3_dist(ship, mars)

        if de < min_d_earth:
            min_d_earth = de
            t_min_earth = t

        if dm < min_d_mars:
            min_d_mars = dm
            t_min_mars = t

        if ok and (de < r_excl_earth or dm < r_excl_mars):
            ok = False
            if de < r_excl_earth:
                first_violation = f"earth penetration at t={t:.3f} d={de:.4f} < r_excl={r_excl_earth:.4f}"
            else:
                first_violation = f"mars penetration at t={t:.3f} d={dm:.4f} < r_excl={r_excl_mars:.4f}"

    if min_d_earth == float("inf"):
        min_d_earth = 0.0
        t_min_earth = float("nan")

    if min_d_mars == float("inf"):
        min_d_mars = 0.0
        t_min_mars = float("nan")

    return DistanceReport(
        ok=ok,
        min_d_earth=min_d_earth,
        t_min_earth=t_min_earth,
        min_d_mars=min_d_mars,
        t_min_mars=t_min_mars,
        first_violation=first_violation,
    )


def validate_linear_interpolation(
    engine,
    r_excl_earth: float,
    r_excl_mars: float,
    pos_fn: Callable[[float], Vec3],
    t0: float,
    t1: float,
    *,
    dt_frame: float,
    substeps: int,
) -> DistanceReport:
    dt_frame = float(max(1e-6, dt_frame))
    substeps = max(2, int(substeps))

    key_samples = build_samples_by_dt(pos_fn, t0, t1, dt_days=dt_frame)
    if len(key_samples) < 2:
        return check_no_penetration(engine, r_excl_earth, r_excl_mars, key_samples)

    min_d_earth = float("inf")
    min_d_mars = float("inf")
    t_min_earth = float("nan")
    t_min_mars = float("nan")

    ok = True
    first_violation: str | None = None

    for idx in range(len(key_samples) - 1):
        t_a, p_a = key_samples[idx]
        t_b, p_b = key_samples[idx + 1]
        dt = float(t_b - t_a)
        if dt <= 0:
            continue

        for j in range(substeps + 1):
            u = j / substeps
            t = t_a + dt * u
            ship = (p_a[0] + (p_b[0] - p_a[0]) * u, p_a[1] + (p_b[1] - p_a[1]) * u, p_a[2] + (p_b[2] - p_a[2]) * u)

            earth = engine.get_planet_position("earth", t)
            mars = engine.get_planet_position("mars", t)

            de = v3_dist(ship, earth)
            dm = v3_dist(ship, mars)

            if de < min_d_earth:
                min_d_earth = de
                t_min_earth = t

            if dm < min_d_mars:
                min_d_mars = dm
                t_min_mars = t

            if ok and (de < r_excl_earth or dm < r_excl_mars):
                ok = False
                if de < r_excl_earth:
                    first_violation = f"earth penetration at t={t:.3f} d={de:.4f} < r_excl={r_excl_earth:.4f}"
                else:
                    first_violation = f"mars penetration at t={t:.3f} d={dm:.4f} < r_excl={r_excl_mars:.4f}"

    if min_d_earth == float("inf"):
        min_d_earth = 0.0
        t_min_earth = float("nan")

    if min_d_mars == float("inf"):
        min_d_mars = 0.0
        t_min_mars = float("nan")

    return DistanceReport(
        ok=ok,
        min_d_earth=min_d_earth,
        t_min_earth=t_min_earth,
        min_d_mars=min_d_mars,
        t_min_mars=t_min_mars,
        first_violation=first_violation,
    )


def prograde_basis_xy(pos_xy: Vec2, vel_xy: Vec2) -> Tuple[Vec2, Vec2]:
    r_hat = v2_unit(pos_xy)
    t_hat = (-r_hat[1], r_hat[0])
    if v2_dot(t_hat, vel_xy) < 0:
        t_hat = (-t_hat[0], -t_hat[1])
    return r_hat, t_hat


@dataclass(frozen=True)
class PlotParams:
    earth_show_days: float = 70.0
    mars_show_days: float = 120.0

    n_track: int = 450
    n_parking: int = 220
    n_transfer: int = 650

    validate_dt_days: float = 0.25

    interp_check_dt_days: Tuple[float, ...] = (0.5, 1.0, 5.0)
    interp_substeps: int = 10

    marker_count_parking: int = 18
    marker_count_transfer: int = 26
    marker_r_px: float = 3.4

    tangent_marker_len: float = 0.09


def main() -> None:
    repo_root = Path(__file__).resolve().parent
    sys.path.insert(0, str(repo_root / "backend"))

    from orbit_engine import OrbitEngine

    engine = OrbitEngine()
    engine.get_schedule_preview(2)

    schedule0 = engine._schedules[0]
    t_start = float(schedule0.t_start)
    t_dep_em = float(schedule0.leg_outbound.t_depart)
    t_arr_m = float(schedule0.leg_outbound.t_arrive)
    t_dep_me = float(schedule0.leg_inbound.t_depart)
    t_arr_e = float(schedule0.leg_inbound.t_arrive)

    params = PlotParams()

    r_excl_earth = engine.earth_visual_r + engine.safety_margin + engine.spacecraft_collision_r
    r_excl_mars = engine.mars_visual_r + engine.safety_margin + engine.spacecraft_collision_r

    plot_t0 = max(0.0, t_dep_em - params.earth_show_days)
    plot_t1 = t_arr_e + params.earth_show_days

    mars_park_arr_t1 = t_arr_m + params.mars_show_days
    mars_park_dep_t0 = max(t_arr_m, t_dep_me - params.mars_show_days)

    ship_pos = engine.get_spacecraft_position

    earth_park0 = build_samples_by_count(ship_pos, plot_t0, t_dep_em, n=params.n_parking)
    out_transfer = build_samples_by_count(lambda tt: engine._get_transfer_position(schedule0.leg_outbound, tt), t_dep_em, t_arr_m, n=params.n_transfer)
    mars_park_arr = build_samples_by_count(ship_pos, t_arr_m, mars_park_arr_t1, n=params.n_parking)
    mars_park_dep = build_samples_by_count(ship_pos, mars_park_dep_t0, t_dep_me, n=params.n_parking)
    in_transfer = build_samples_by_count(lambda tt: engine._get_transfer_position(schedule0.leg_inbound, tt), t_dep_me, t_arr_e, n=params.n_transfer)
    earth_park2 = build_samples_by_count(ship_pos, t_arr_e, plot_t1, n=params.n_parking)

    e_track = build_samples_by_count(lambda tt: engine.get_planet_position("earth", tt), plot_t0, plot_t1, n=params.n_track)
    m_track = build_samples_by_count(lambda tt: engine.get_planet_position("mars", tt), plot_t0, plot_t1, n=params.n_track)

    outbound_report = check_no_penetration(engine, r_excl_earth, r_excl_mars, out_transfer)
    inbound_report = check_no_penetration(engine, r_excl_earth, r_excl_mars, in_transfer)

    full_samples = build_samples_by_dt(ship_pos, plot_t0, plot_t1, dt_days=params.validate_dt_days)
    full_report = check_no_penetration(engine, r_excl_earth, r_excl_mars, full_samples)

    interp_reports: List[Tuple[float, DistanceReport]] = []
    for dt_frame in params.interp_check_dt_days:
        interp_reports.append(
            (float(dt_frame), validate_linear_interpolation(engine, r_excl_earth, r_excl_mars, ship_pos, plot_t0, plot_t1, dt_frame=float(dt_frame), substeps=params.interp_substeps))
        )

    dt_dir = 1e-3

    def speed_dir_forward(pos_fn: Callable[[float], Vec3], t: float) -> Tuple[float, Vec2]:
        p0 = pos_fn(t)
        p1 = pos_fn(t + dt_dir)
        return v3_dist(p0, p1) / dt_dir, dir_xy(p0, p1)

    def speed_dir_backward(pos_fn: Callable[[float], Vec3], t: float) -> Tuple[float, Vec2]:
        p0 = pos_fn(t - dt_dir)
        p1 = pos_fn(t)
        return v3_dist(p0, p1) / dt_dir, dir_xy(p0, p1)

    v_park_e_dep, d_park_e_dep = speed_dir_forward(ship_pos, t_dep_em)
    v_out0, d_out0 = speed_dir_forward(lambda tt: engine._get_transfer_position(schedule0.leg_outbound, tt), t_dep_em)

    v_out1, d_out1 = speed_dir_backward(lambda tt: engine._get_transfer_position(schedule0.leg_outbound, tt), t_arr_m)
    v_park_m_arr, d_park_m_arr = speed_dir_forward(ship_pos, t_arr_m)

    v_park_m_dep, d_park_m_dep = speed_dir_backward(ship_pos, t_dep_me)
    v_in0, d_in0 = speed_dir_forward(lambda tt: engine._get_transfer_position(schedule0.leg_inbound, tt), t_dep_me)

    v_in1, d_in1 = speed_dir_backward(lambda tt: engine._get_transfer_position(schedule0.leg_inbound, tt), t_arr_e)
    v_park_e_arr, d_park_e_arr = speed_dir_forward(ship_pos, t_arr_e)

    deg_e_dep = angle_between_deg(d_park_e_dep, d_out0)
    deg_m_arr = angle_between_deg(d_out1, d_park_m_arr)
    deg_m_dep = angle_between_deg(d_park_m_dep, d_in0)
    deg_e_arr = angle_between_deg(d_in1, d_park_e_arr)

    def v_norm(a: Vec3) -> float:
        return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])

    def v_sub(a: Vec3, b: Vec3) -> Vec3:
        return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

    def dv_cost(leg) -> Tuple[float, float, float]:
        v_source = engine.get_planet_velocity(leg.source, leg.t_depart)
        v_target = engine.get_planet_velocity(leg.target, leg.t_arrive)
        dv1 = v_norm(v_sub(leg.vel_depart, v_source))
        dv2 = v_norm(v_sub(leg.vel_arrive, v_target))
        return dv1, dv2, dv1 + dv2

    dv_out = dv_cost(schedule0.leg_outbound)
    dv_in = dv_cost(schedule0.leg_inbound)

    earth_park0_xy = [v3_xy(p) for _, p in earth_park0]
    out_xy = [v3_xy(p) for _, p in out_transfer]
    mars_park_arr_xy = [v3_xy(p) for _, p in mars_park_arr]
    mars_park_dep_xy = [v3_xy(p) for _, p in mars_park_dep]
    in_xy = [v3_xy(p) for _, p in in_transfer]
    earth_park2_xy = [v3_xy(p) for _, p in earth_park2]

    e_track_xy = [v3_xy(p) for _, p in e_track]
    m_track_xy = [v3_xy(p) for _, p in m_track]

    all_xy: List[Vec2] = []
    all_xy += e_track_xy + m_track_xy
    all_xy += earth_park0_xy + out_xy + mars_park_arr_xy + mars_park_dep_xy + in_xy + earth_park2_xy

    xs = [p[0] for p in all_xy]
    ys = [p[1] for p in all_xy]
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)

    pad_world = 0.45
    xmin -= pad_world
    xmax += pad_world
    ymin -= pad_world
    ymax += pad_world

    W, H = 1000, 1000
    PAD = 40
    dx = max(1e-9, xmax - xmin)
    dy = max(1e-9, ymax - ymin)
    scale = min((W - 2 * PAD) / dx, (H - 2 * PAD) / dy)

    def to_svg(p: Vec2) -> Vec2:
        x = PAD + (p[0] - xmin) * scale
        y = PAD + (ymax - p[1]) * scale
        return (x, y)

    def spline_path(points_world: List[Vec2]) -> str:
        return catmull_rom_spline_path([to_svg(p) for p in points_world])

    def circle(center_xy: Vec2, r_world: float, *, stroke: str, fill: str, fill_op: float = 0.18, dash: str | None = None) -> str:
        cx, cy = to_svg(center_xy)
        r = r_world * scale
        dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
        fill_attr = fill if fill != "none" else "none"
        fill_op_attr = f' fill-opacity="{fill_op:.3f}"' if fill != "none" else ""
        return (
            f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" '
            f'stroke="{stroke}" stroke-width="2" fill="{fill_attr}"{fill_op_attr}{dash_attr}/>'
        )

    def dot_world(p_world: Vec2, *, fill: str, r_px: float = 4.0, fill_op: float = 1.0, stroke: str = "none", stroke_op: float = 1.0) -> str:
        x, y = to_svg(p_world)
        return (
            f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{r_px:.2f}" '
            f'fill="{fill}" fill-opacity="{fill_op:.3f}" stroke="{stroke}" stroke-opacity="{stroke_op:.3f}" stroke-width="1"/>'
        )

    def timed_markers(points_world: List[Vec2], *, count: int, fill: str, fill_op: float) -> List[str]:
        if count <= 2 or len(points_world) < 3:
            return []
        out: List[str] = []
        last_idx = len(points_world) - 1
        for i in range(1, count - 1):
            idx = round(i * last_idx / (count - 1))
            out.append(dot_world(points_world[idx], fill=fill, r_px=params.marker_r_px, fill_op=fill_op, stroke="#e2e8f0", stroke_op=0.85))
        return out

    def tangent_marker(planet: str, t: float, origin_world: Vec2, *, color: str) -> str:
        pos = engine.get_planet_position(planet, t)
        vel = engine.get_planet_velocity(planet, t)
        _r_hat, t_hat = prograde_basis_xy(v3_xy(pos), v3_xy(vel))
        p1 = origin_world
        p2 = v2_add(origin_world, v2_mul(t_hat, params.tangent_marker_len))
        a = to_svg(p1)
        b = to_svg(p2)
        return (
            f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}" '
            f'stroke="{color}" stroke-width="2" opacity="0.75"/>'
        )

    def fmt_interp_summary(reports: Sequence[Tuple[float, DistanceReport]]) -> str:
        parts: List[str] = []
        for dt_frame, rep in reports:
            margin_e = rep.min_d_earth - r_excl_earth
            margin_m = rep.min_d_mars - r_excl_mars
            parts.append(f"{dt_frame:g}d:{'OK' if rep.ok else 'FAIL'}(ΔE={margin_e:+.3f},ΔM={margin_m:+.3f})")
        return " ".join(parts)

    e_dep_xy = v3_xy(engine.get_planet_position("earth", t_dep_em))
    m_arr_xy = v3_xy(engine.get_planet_position("mars", t_arr_m))
    m_dep_xy = v3_xy(engine.get_planet_position("mars", t_dep_me))
    e_arr_xy = v3_xy(engine.get_planet_position("earth", t_arr_e))

    ship_e_dep_xy = v3_xy(engine._outer_parking_point("earth", t_dep_em))
    ship_m_arr_xy = v3_xy(engine._outer_parking_point("mars", t_arr_m))
    ship_m_dep_xy = v3_xy(engine._outer_parking_point("mars", t_dep_me))
    ship_e_arr_xy = v3_xy(engine._outer_parking_point("earth", t_arr_e))

    stroke_edges = 'stroke-linecap="round" stroke-linejoin="round"'

    svg_lines: List[str] = []
    svg_lines.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
    svg_lines.append(f'<rect x="0" y="0" width="{W}" height="{H}" fill="#070b12"/>')
    svg_lines.append('<style> .label{fill:#cfd7ff;font:14px ui-sans-serif,system-ui;} .sub{fill:#94a3b8;font:12px ui-sans-serif,system-ui;} </style>')

    svg_lines.append(f'<path d="{spline_path(e_track_xy)}" {stroke_edges} stroke="#2b6cb0" stroke-width="1.2" fill="none" opacity="0.35"/>')
    svg_lines.append(f'<path d="{spline_path(m_track_xy)}" {stroke_edges} stroke="#c05621" stroke-width="1.2" fill="none" opacity="0.35"/>')

    svg_lines.append(f'<path d="{spline_path(earth_park0_xy)}" {stroke_edges} stroke="#60a5fa" stroke-width="2.4" fill="none" opacity="0.85"/>')
    svg_lines.append(f'<path d="{spline_path(out_xy)}" {stroke_edges} stroke="#fbbf24" stroke-width="2.8" fill="none" opacity="0.95"/>')
    svg_lines.append(f'<path d="{spline_path(mars_park_arr_xy)}" {stroke_edges} stroke="#fb7185" stroke-width="2.4" fill="none" opacity="0.60"/>')
    svg_lines.append(f'<path d="{spline_path(mars_park_dep_xy)}" {stroke_edges} stroke="#fb7185" stroke-width="2.4" fill="none" opacity="0.85"/>')
    svg_lines.append(f'<path d="{spline_path(in_xy)}" {stroke_edges} stroke="#34d399" stroke-width="2.8" fill="none" opacity="0.95"/>')
    svg_lines.append(f'<path d="{spline_path(earth_park2_xy)}" {stroke_edges} stroke="#60a5fa" stroke-width="2.4" fill="none" opacity="0.85"/>')

    svg_lines += timed_markers(earth_park0_xy, count=params.marker_count_parking, fill="#60a5fa", fill_op=0.60)
    svg_lines += timed_markers(out_xy, count=params.marker_count_transfer, fill="#fbbf24", fill_op=0.75)
    svg_lines += timed_markers(mars_park_arr_xy, count=params.marker_count_parking, fill="#fb7185", fill_op=0.58)
    svg_lines += timed_markers(mars_park_dep_xy, count=params.marker_count_parking, fill="#fb7185", fill_op=0.60)
    svg_lines += timed_markers(in_xy, count=params.marker_count_transfer, fill="#34d399", fill_op=0.75)
    svg_lines += timed_markers(earth_park2_xy, count=params.marker_count_parking, fill="#60a5fa", fill_op=0.60)

    svg_lines.append(circle(e_dep_xy, engine.earth_visual_r, stroke="#3b82f6", fill="#3b82f6", fill_op=0.18))
    svg_lines.append(circle(e_dep_xy, r_excl_earth, stroke="#60a5fa", fill="none", dash="6 6"))
    svg_lines.append(circle(m_arr_xy, engine.mars_visual_r, stroke="#ef4444", fill="#ef4444", fill_op=0.18))
    svg_lines.append(circle(m_arr_xy, r_excl_mars, stroke="#fb7185", fill="none", dash="6 6"))
    svg_lines.append(circle(m_dep_xy, engine.mars_visual_r, stroke="#ef4444", fill="#ef4444", fill_op=0.10))
    svg_lines.append(circle(m_dep_xy, r_excl_mars, stroke="#fb7185", fill="none", dash="6 6"))
    svg_lines.append(circle(e_arr_xy, engine.earth_visual_r, stroke="#3b82f6", fill="#3b82f6", fill_op=0.10))
    svg_lines.append(circle(e_arr_xy, r_excl_earth, stroke="#60a5fa", fill="none", dash="6 6"))

    svg_lines.append(dot_world(ship_e_dep_xy, fill="#fbbf24"))
    svg_lines.append(dot_world(ship_m_arr_xy, fill="#fbbf24"))
    svg_lines.append(dot_world(ship_m_dep_xy, fill="#34d399"))
    svg_lines.append(dot_world(ship_e_arr_xy, fill="#34d399"))

    svg_lines.append(tangent_marker("earth", t_dep_em, ship_e_dep_xy, color="#e2e8f0"))
    svg_lines.append(tangent_marker("mars", t_arr_m, ship_m_arr_xy, color="#e2e8f0"))
    svg_lines.append(tangent_marker("mars", t_dep_me, ship_m_dep_xy, color="#e2e8f0"))
    svg_lines.append(tangent_marker("earth", t_arr_e, ship_e_arr_xy, color="#e2e8f0"))

    svg_lines.append('<text x="24" y="32" class="label">Lambert transfer arcs + parking orbits (clearance-validated)</text>')
    svg_lines.append(
        f'<text x="24" y="54" class="sub">visual_r: earth={engine.earth_visual_r:.3f}, mars={engine.mars_visual_r:.3f}; safety_margin={engine.safety_margin:.3f}; ship_r={engine.spacecraft_collision_r:.3f}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="74" class="sub">parking_r: earth={engine.earth_parking_r:.3f} (P={engine.earth_parking_period_days:.1f}d), mars={engine.mars_parking_r:.3f} (P={engine.mars_parking_period_days:.1f}d)</text>'
    )
    svg_lines.append(
        f'<text x="24" y="94" class="sub">Outbound min(dE)={outbound_report.min_d_earth:.3f}, min(dM)={outbound_report.min_d_mars:.3f}, OK={str(outbound_report.ok)}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="114" class="sub">Inbound  min(dE)={inbound_report.min_d_earth:.3f}, min(dM)={inbound_report.min_d_mars:.3f}, OK={str(inbound_report.ok)}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="134" class="sub">Full traj min(dE)={full_report.min_d_earth:.3f} (t={full_report.t_min_earth:.1f}), min(dM)={full_report.min_d_mars:.3f} (t={full_report.t_min_mars:.1f}), OK={str(full_report.ok)}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="154" class="sub">Linear lerp safety: {fmt_interp_summary(interp_reports)}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="174" class="sub">Join dir Δθ (deg, xy): Edep {deg_e_dep:.2f}, Marr {deg_m_arr:.2f}, Mdep {deg_m_dep:.2f}, Earr {deg_e_arr:.2f}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="194" class="sub">Join speeds AU/day: parkEdep {v_park_e_dep:.4f} vs out0 {v_out0:.4f}; out1 {v_out1:.4f} vs parkMarr {v_park_m_arr:.4f}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="214" class="sub">Join speeds AU/day: parkMdep {v_park_m_dep:.4f} vs in0 {v_in0:.4f}; in1 {v_in1:.4f} vs parkEarr {v_park_e_arr:.4f}</text>'
    )
    svg_lines.append(
        f'<text x="24" y="234" class="sub">Lambert dv proxy (AU/day): out dv1={dv_out[0]:.4f} dv2={dv_out[1]:.4f} sum={dv_out[2]:.4f}; in dv1={dv_in[0]:.4f} dv2={dv_in[1]:.4f} sum={dv_in[2]:.4f}</text>'
    )

    svg_lines.append("</svg>")

    out_path = repo_root / "demo_trajectory_lambert.svg"
    out_path.write_text("\n".join(svg_lines) + "\n", encoding="utf-8")

    print(f"Output: {out_path}")
    print(f"Schedule0 t_start={t_start:.3f} launch={t_dep_em:.3f} arr_mars={t_arr_m:.3f} dep_mars={t_dep_me:.3f} arr_earth={t_arr_e:.3f}")
    print(f"Exclusion radii: earth={r_excl_earth:.4f}, mars={r_excl_mars:.4f}")

    print(f"Outbound OK={outbound_report.ok} min(dE)={outbound_report.min_d_earth:.3f} min(dM)={outbound_report.min_d_mars:.3f}")
    if not outbound_report.ok and outbound_report.first_violation:
        print(f"Outbound violation: {outbound_report.first_violation}")

    print(f"Inbound  OK={inbound_report.ok} min(dE)={inbound_report.min_d_earth:.3f} min(dM)={inbound_report.min_d_mars:.3f}")
    if not inbound_report.ok and inbound_report.first_violation:
        print(f"Inbound violation: {inbound_report.first_violation}")

    print(f"Full trajectory OK={full_report.ok} min(dE)={full_report.min_d_earth:.3f} at t={full_report.t_min_earth:.2f}, min(dM)={full_report.min_d_mars:.3f} at t={full_report.t_min_mars:.2f}")
    if not full_report.ok and full_report.first_violation:
        print(f"Full trajectory violation: {full_report.first_violation}")

    print("\nJoin direction deltas (deg, xy):")
    print(f"  Earth depart: {deg_e_dep:.3f}")
    print(f"  Mars arrive : {deg_m_arr:.3f}")
    print(f"  Mars depart : {deg_m_dep:.3f}")
    print(f"  Earth arrive: {deg_e_arr:.3f}")

    print("\nJoin speeds (AU/day):")
    print(f"  parkEdep={v_park_e_dep:.6f} out0={v_out0:.6f}")
    print(f"  out1={v_out1:.6f} parkMarr={v_park_m_arr:.6f}")
    print(f"  parkMdep={v_park_m_dep:.6f} in0={v_in0:.6f}")
    print(f"  in1={v_in1:.6f} parkEarr={v_park_e_arr:.6f}")

    print("\nLambert dv proxy (AU/day):")
    print(f"  outbound: dv1={dv_out[0]:.6f} dv2={dv_out[1]:.6f} sum={dv_out[2]:.6f}")
    print(f"  inbound : dv1={dv_in[0]:.6f} dv2={dv_in[1]:.6f} sum={dv_in[2]:.6f}")

    print("\nLinear interpolation safety (lerp between keyframes):")
    for dt_frame, rep in interp_reports:
        margin_e = rep.min_d_earth - r_excl_earth
        margin_m = rep.min_d_mars - r_excl_mars
        status = "OK" if rep.ok else "FAIL"
        msg = f"  dt={dt_frame:g}d: {status} min(dE)={rep.min_d_earth:.3f} (Δ={margin_e:+.3f}) min(dM)={rep.min_d_mars:.3f} (Δ={margin_m:+.3f})"
        print(msg)
        if not rep.ok and rep.first_violation:
            print(f"    {rep.first_violation}")


if __name__ == "__main__":
    main()
