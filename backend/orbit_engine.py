import math
from bisect import bisect_right
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Dict, Tuple, List, Optional

import numpy as np

class MissionPhase(Enum):
    EARTH_ORBIT_STAY = "earth_orbit_stay"
    TRANSFER_TO_MARS = "transfer_to_mars"
    MARS_ORBIT_STAY = "mars_orbit_stay"
    TRANSFER_TO_EARTH = "transfer_to_earth"

@dataclass
class OrbitalElements:
    a: float  # Semi-major axis (AU)
    e: float  # Eccentricity
    i: float  # Inclination (degrees)
    omega: float  # Argument of periapsis (degrees)
    Omega: float  # Longitude of ascending node (degrees)
    M0: float  # Mean anomaly at epoch (degrees)
    period: float  # Orbital period (days)

@dataclass(frozen=True)
class TransferLeg:
    source: str
    target: str
    t_depart: float
    t_arrive: float
    duration: float

    pos_depart: Tuple[float, float, float]
    pos_arrive: Tuple[float, float, float]
    vel_depart: Tuple[float, float, float]
    vel_arrive: Tuple[float, float, float]

    prograde: bool
    long_way: bool

@dataclass(frozen=True)
class MissionSchedule:
    mission_index: int
    t_start: float
    leg_outbound: TransferLeg  # Earth -> Mars
    leg_inbound: TransferLeg  # Mars -> Earth

class OrbitEngine:
    def __init__(self):
        self.AU = 1.496e11  # Astronomical Unit in meters
        
        # Real planetary orbital elements (JPL data approximation)
        self.planets = {
            'earth': OrbitalElements(
                a=1.00000011,
                e=0.01671022,
                i=0.00005,
                omega=102.9404,
                Omega=0.0,
                M0=357.51716,
                period=365.25636
            ),
            'mars': OrbitalElements(
                a=1.52366231,
                e=0.09341233,
                i=1.85061,
                omega=286.5016,
                Omega=49.57854,
                M0=19.41248,
                period=686.97976
            )
        }

        # Sun gravitational parameter in AU^3 / day^2 (canonical value).
        self.mu_sun = 0.0002959122082855911

        self.earth_visual_r = 0.12
        self.mars_visual_r = 0.08
        self.safety_margin = 0.04
        self.spacecraft_collision_r = 0.006

        self.earth_parking_r = 0.2
        self.mars_parking_r = 0.18

        self.earth_parking_period_days = 70.0
        self.mars_parking_period_days = 55.0

        self.transfer_warp_sigma_frac = 0.05

        self.clearance_check_dt_days = 0.25
        self.clearance_depart_step_days = 1.0
        self.clearance_max_out_attempts = 12
        self.clearance_max_in_attempts = 60
        self.clearance_extra_margin = 0.0
 
        if self.earth_parking_r <= (self.earth_visual_r + self.safety_margin + self.spacecraft_collision_r):
            raise ValueError("earth_parking_r must be > earth_visual_r + safety_margin + spacecraft_collision_r")
        if self.mars_parking_r <= (self.mars_visual_r + self.safety_margin + self.spacecraft_collision_r):
            raise ValueError("mars_parking_r must be > mars_visual_r + safety_margin + spacecraft_collision_r")

        # Launch window search / refinement settings.
        self.launch_scan_window_days = 1400.0
        self.launch_coarse_step_days = 2.0
        self.launch_refine_window_days = 80.0
        self.launch_refine_step_days = 0.5

        self.lambert_dt_min_days = 180.0
        self.lambert_dt_max_days = 450.0
        self.lambert_dt_step_days = 5.0
        self.lambert_dt_window_days = 80.0
        self.lambert_depart_window_days = self.launch_refine_window_days
        self.lambert_depart_step_days = 2.0
        self.lambert_phase_scan_step_days = 10.0
        self.lambert_try_long_way = False
        self.lambert_max_total_dv = 0.006

        self._transfer_time_guess: dict[tuple[str, str], float] = {
            ("earth", "mars"): 259.0,
            ("mars", "earth"): 259.0,
        }


        # Dynamic mission schedules (generated on demand).
        self._schedules: list[MissionSchedule] = []
        self._schedule_end_times: list[float] = []

    def solve_kepler_equation(self, M: float, e: float, tol: float = 1e-10, max_iter: int = 100) -> float:
        M_rad = np.radians(M)
        E = M_rad  # Initial guess
        
        for _ in range(max_iter):
            delta = E - e * np.sin(E) - M_rad
            if abs(delta) < tol:
                break
            E = E - delta / (1 - e * np.cos(E))
        
        return np.degrees(E)

    def get_planet_position(self, planet: str, time_days: float) -> Tuple[float, float, float]:
        if planet not in self.planets:
            raise ValueError(f"Unknown planet: {planet}")
        
        elem = self.planets[planet]
        
        # Mean motion
        n = 360.0 / elem.period
        
        # Mean anomaly at time t
        M = (elem.M0 + n * time_days) % 360
        
        # Eccentric anomaly
        E = self.solve_kepler_equation(M, elem.e)
        
        # True anomaly
        E_rad = np.radians(E)
        e = elem.e
        nu = 2 * np.arctan2(np.sqrt(1 + e) * np.sin(E_rad / 2),
                           np.sqrt(1 - e) * np.cos(E_rad / 2))
        nu = np.degrees(nu)
        
        # Distance from sun
        r = elem.a * (1 - elem.e * np.cos(E_rad))
        
        # Orbital plane coordinates
        omega_rad = np.radians(elem.omega)
        nu_rad = np.radians(nu)
        x_orb = r * np.cos(nu_rad)
        y_orb = r * np.sin(nu_rad)
        
        # Rotate to 3D space
        i_rad = np.radians(elem.i)
        Omega_rad = np.radians(elem.Omega)
        
        x = x_orb * (np.cos(omega_rad) * np.cos(Omega_rad) - np.sin(omega_rad) * np.sin(Omega_rad) * np.cos(i_rad)) - \
            y_orb * (np.sin(omega_rad) * np.cos(Omega_rad) + np.cos(omega_rad) * np.sin(Omega_rad) * np.cos(i_rad))
        
        y = x_orb * (np.cos(omega_rad) * np.sin(Omega_rad) + np.sin(omega_rad) * np.cos(Omega_rad) * np.cos(i_rad)) - \
            y_orb * (np.sin(omega_rad) * np.sin(Omega_rad) - np.cos(omega_rad) * np.cos(Omega_rad) * np.cos(i_rad))
        
        z = x_orb * (np.sin(omega_rad) * np.sin(i_rad)) + y_orb * (np.cos(omega_rad) * np.sin(i_rad))
        
        return (x, y, z)

    def get_planet_velocity(self, planet: str, time_days: float) -> Tuple[float, float, float]:
        dt = 0.01  # Small time step
        pos1 = self.get_planet_position(planet, time_days)
        pos2 = self.get_planet_position(planet, time_days + dt)
        
        vx = (pos2[0] - pos1[0]) / dt
        vy = (pos2[1] - pos1[1]) / dt
        vz = (pos2[2] - pos1[2]) / dt
        
        return (vx, vy, vz)

    @staticmethod
    def _wrap_to_pi(angle_rad: float) -> float:
        """Wrap angle to (-pi, pi]."""
        wrapped = (angle_rad + math.pi) % (2 * math.pi) - math.pi
        return wrapped if wrapped != -math.pi else math.pi

    @staticmethod
    def _r_xy(pos: Tuple[float, float, float]) -> float:
        return math.hypot(pos[0], pos[1])

    @staticmethod
    def _theta_xy(pos: Tuple[float, float, float]) -> float:
        return math.atan2(pos[1], pos[0])

    def _parking_radius(self, planet: str) -> float:
        if planet == "earth":
            return self.earth_parking_r
        if planet == "mars":
            return self.mars_parking_r
        raise ValueError(f"Unknown planet for parking orbit: {planet}")

    def _r_hat_xy(self, pos: Tuple[float, float, float]) -> Tuple[float, float]:
        r = self._r_xy(pos)
        if r == 0:
            return (1.0, 0.0)
        return (pos[0] / r, pos[1] / r)

    def _prograde_basis_xy(self, pos: Tuple[float, float, float], vel: Tuple[float, float, float]) -> Tuple[Tuple[float, float], Tuple[float, float]]:
        r_hat = self._r_hat_xy(pos)
        t_hat = (-r_hat[1], r_hat[0])
        if (t_hat[0] * vel[0] + t_hat[1] * vel[1]) < 0:
            t_hat = (-t_hat[0], -t_hat[1])
        return r_hat, t_hat

    def _outer_parking_point(self, planet: str, time_days: float) -> Tuple[float, float, float]:
        pos = self.get_planet_position(planet, time_days)
        r_hat = self._r_hat_xy(pos)
        radius = self._parking_radius(planet)
        return (pos[0] + r_hat[0] * radius, pos[1] + r_hat[1] * radius, pos[2])

    def _parking_position(
        self,
        planet: str,
        time_days: float,
        *,
        t_anchor: float,
        radius: float,
        period_days: float,
    ) -> Tuple[float, float, float]:
        pos = self.get_planet_position(planet, time_days)
        vel = self.get_planet_velocity(planet, time_days)
        r_hat, t_hat = self._prograde_basis_xy(pos, vel)

        omega = 2.0 * math.pi / max(1e-9, float(period_days))
        phi = omega * (float(time_days) - float(t_anchor))

        dx = (math.cos(phi) * radius) * r_hat[0] + (math.sin(phi) * radius) * t_hat[0]
        dy = (math.cos(phi) * radius) * r_hat[1] + (math.sin(phi) * radius) * t_hat[1]
        return (pos[0] + dx, pos[1] + dy, pos[2])

    @staticmethod
    def _fit_parking_period(duration_days: float, nominal_period_days: float) -> Tuple[float, int]:
        duration = float(max(1e-6, duration_days))
        nominal = float(max(1e-6, nominal_period_days))
        revolutions = int(round(duration / nominal))
        revolutions = max(1, revolutions)
        period = duration / revolutions
        return period, revolutions

    @staticmethod
    def _estimate_speed(pos_fn: Callable[[float], Tuple[float, float, float]], t: float, *, dt: float = 1e-3) -> float:
        dt = float(dt)
        if dt <= 0:
            dt = 1e-3
        p0 = pos_fn(float(t))
        p1 = pos_fn(float(t) + dt)
        return math.sqrt((p1[0] - p0[0]) ** 2 + (p1[1] - p0[1]) ** 2 + (p1[2] - p0[2]) ** 2) / dt

    @staticmethod
    def _dist3(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
        dx = a[0] - b[0]
        dy = a[1] - b[1]
        dz = a[2] - b[2]
        return math.sqrt(dx * dx + dy * dy + dz * dz)

    def _exclusion_radius(self, planet: str) -> float:
        base = self.safety_margin + self.spacecraft_collision_r
        if planet == "earth":
            return self.earth_visual_r + base
        if planet == "mars":
            return self.mars_visual_r + base
        raise ValueError(f"Unknown planet for exclusion radius: {planet}")

    def _transfer_leg_clearance_ok(self, leg: TransferLeg) -> bool:
        dt = float(max(1e-6, self.clearance_check_dt_days))
        extra = float(max(0.0, self.clearance_extra_margin))

        r_excl_earth = self._exclusion_radius("earth") + extra
        r_excl_mars = self._exclusion_radius("mars") + extra

        t0 = float(leg.t_depart)
        t1 = float(leg.t_arrive)
        if t1 <= t0:
            return True

        def min_clearance(dt_local: float) -> float:
            dt_local = float(max(1e-6, dt_local))
            steps = int(math.ceil((t1 - t0) / dt_local))
            steps = max(1, steps)

            best = float("inf")
            for i in range(steps + 1):
                t = t0 + (t1 - t0) * (i / steps)
                ship = self._get_transfer_position(leg, t)
                earth = self.get_planet_position("earth", t)
                mars = self.get_planet_position("mars", t)

                ce = self._dist3(ship, earth) - r_excl_earth
                cm = self._dist3(ship, mars) - r_excl_mars
                if ce < best:
                    best = ce
                if cm < best:
                    best = cm

                if best < 0.0:
                    return best

            return best

        coarse = min_clearance(dt)
        if coarse < 0.0:
            return False

        if coarse < 5e-3:
            fine_dt = max(1e-6, dt / 5.0)
            fine = min_clearance(fine_dt)
            return fine >= 0.0

        return True
 
    @staticmethod
    def _stumpff_C(z: float) -> float:
        z = float(z)
        az = abs(z)
        if az < 1e-8:
            return 0.5 - z / 24.0 + (z * z) / 720.0 - (z * z * z) / 40320.0
        if z > 0.0:
            s = math.sqrt(z)
            return (1.0 - math.cos(s)) / z
        s = math.sqrt(-z)
        return (math.cosh(s) - 1.0) / (s * s)

    @staticmethod
    def _stumpff_S(z: float) -> float:
        z = float(z)
        az = abs(z)
        if az < 1e-8:
            return 1.0 / 6.0 - z / 120.0 + (z * z) / 5040.0 - (z * z * z) / 362880.0
        if z > 0.0:
            s = math.sqrt(z)
            return (s - math.sin(s)) / (s * s * s)
        s = math.sqrt(-z)
        return (math.sinh(s) - s) / (s * s * s)

    @staticmethod
    def _dot3(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    @staticmethod
    def _cross3(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> Tuple[float, float, float]:
        return (
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        )

    @staticmethod
    def _norm3(a: Tuple[float, float, float]) -> float:
        return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])

    @staticmethod
    def _v3_add(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> Tuple[float, float, float]:
        return (a[0] + b[0], a[1] + b[1], a[2] + b[2])

    @staticmethod
    def _v3_sub(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> Tuple[float, float, float]:
        return (a[0] - b[0], a[1] - b[1], a[2] - b[2])

    @staticmethod
    def _v3_mul(a: Tuple[float, float, float], s: float) -> Tuple[float, float, float]:
        s = float(s)
        return (a[0] * s, a[1] * s, a[2] * s)

    @staticmethod
    def _estimate_velocity(pos_fn: Callable[[float], Tuple[float, float, float]], t: float, *, dt: float = 1e-3) -> Tuple[float, float, float]:
        dt = float(dt)
        if dt <= 0:
            dt = 1e-3
        p0 = pos_fn(float(t))
        p1 = pos_fn(float(t) + dt)
        return ((p1[0] - p0[0]) / dt, (p1[1] - p0[1]) / dt, (p1[2] - p0[2]) / dt)

    def _lambert_uv(
        self,
        r1_vec: Tuple[float, float, float],
        r2_vec: Tuple[float, float, float],
        dt_days: float,
        *,
        prograde: bool,
        long_way: bool,
    ) -> Optional[Tuple[Tuple[float, float, float], Tuple[float, float, float]]]:
        dt_days = float(dt_days)
        if dt_days <= 0.0:
            return None

        r1 = self._norm3(r1_vec)
        r2 = self._norm3(r2_vec)
        if r1 <= 0.0 or r2 <= 0.0:
            return None

        cos_theta = self._dot3(r1_vec, r2_vec) / (r1 * r2)
        cos_theta = max(-1.0, min(1.0, float(cos_theta)))
        theta0 = math.acos(cos_theta)

        cross = self._cross3(r1_vec, r2_vec)
        cross_z = cross[2]

        if prograde:
            theta_short = theta0 if cross_z >= 0.0 else (2.0 * math.pi - theta0)
        else:
            theta_short = theta0 if cross_z < 0.0 else (2.0 * math.pi - theta0)

        theta = (2.0 * math.pi - theta_short) if long_way else theta_short

        sin_theta = math.sin(theta)
        if (1.0 + cos_theta) < 1e-12:
            return None

        A = math.copysign(math.sqrt(r1 * r2 * (1.0 + cos_theta)), sin_theta if abs(sin_theta) > 1e-15 else 1.0)
        if abs(A) < 1e-15:
            return None

        sqrt_mu = math.sqrt(self.mu_sun)

        def tof_at_z(z: float) -> Optional[Tuple[float, float, float, float]]:
            C = self._stumpff_C(z)
            S = self._stumpff_S(z)
            if C <= 0.0:
                return None

            sqrt_C = math.sqrt(C)
            y = r1 + r2 + A * (z * S - 1.0) / sqrt_C
            if y < 0.0:
                return None

            sqrt_y = math.sqrt(y)
            chi = sqrt_y / sqrt_C
            tof = (chi * chi * chi * S + A * sqrt_y) / sqrt_mu
            return tof, y, C, S

        t0 = tof_at_z(0.0)
        if t0 is None:
            return None

        tof0 = t0[0]
        z_low = 0.0
        z_high = 0.0

        if tof0 < dt_days:
            z_low = 0.0
            z_high = 1.0
            for _ in range(60):
                out = tof_at_z(z_high)
                if out is not None and out[0] >= dt_days:
                    break
                z_high *= 2.0
                if z_high > 1000.0:
                    return None
        else:
            z_high = 0.0
            z_low = -1.0
            for _ in range(60):
                out = tof_at_z(z_low)
                if out is not None and out[0] <= dt_days:
                    break
                z_low *= 2.0
                if z_low < -1000.0:
                    return None

        z = 0.5 * (z_low + z_high)
        y = None
        C = None
        S = None

        for _ in range(80):
            out = tof_at_z(z)
            if out is None:
                z_low = z
                z = 0.5 * (z_low + z_high)
                continue

            tof, y, C, S = out
            err = tof - dt_days
            if abs(err) < 1e-6:
                break

            if tof < dt_days:
                z_low = z
            else:
                z_high = z
            z = 0.5 * (z_low + z_high)

        if y is None or C is None or S is None:
            return None

        f = 1.0 - y / r1
        g = A * math.sqrt(y / self.mu_sun)
        gdot = 1.0 - y / r2

        if abs(g) < 1e-12:
            return None

        v1 = (
            (r2_vec[0] - f * r1_vec[0]) / g,
            (r2_vec[1] - f * r1_vec[1]) / g,
            (r2_vec[2] - f * r1_vec[2]) / g,
        )
        v2 = (
            (gdot * r2_vec[0] - r1_vec[0]) / g,
            (gdot * r2_vec[1] - r1_vec[1]) / g,
            (gdot * r2_vec[2] - r1_vec[2]) / g,
        )
        return v1, v2

    def _propagate_two_body(
        self,
        r0_vec: Tuple[float, float, float],
        v0_vec: Tuple[float, float, float],
        dt_days: float,
    ) -> Tuple[Tuple[float, float, float], Tuple[float, float, float]]:
        dt_days = float(dt_days)
        if dt_days == 0.0:
            return r0_vec, v0_vec

        r0 = self._norm3(r0_vec)
        if r0 <= 0.0:
            return r0_vec, v0_vec

        mu = self.mu_sun
        sqrt_mu = math.sqrt(mu)

        v0_sq = self._dot3(v0_vec, v0_vec)
        alpha = 2.0 / r0 - v0_sq / mu
        r0v0 = self._dot3(r0_vec, v0_vec)

        chi = sqrt_mu * dt_days / r0
        if dt_days < 0.0:
            chi = -abs(chi)

        for _ in range(60):
            z = alpha * chi * chi
            C = self._stumpff_C(z)
            S = self._stumpff_S(z)

            t = (
                (chi * chi * chi * S)
                + (r0v0 / sqrt_mu) * (chi * chi * C)
                + r0 * chi * (1.0 - z * S)
            ) / sqrt_mu
            f = t - dt_days

            if abs(f) < 1e-9:
                break

            dtdchi = (
                (chi * chi * C)
                + (r0v0 / sqrt_mu) * chi * (1.0 - z * S)
                + r0 * (1.0 - z * C)
            ) / sqrt_mu

            if dtdchi == 0.0:
                break

            chi -= f / dtdchi

        if not math.isfinite(chi):
            return r0_vec, v0_vec

        z = alpha * chi * chi
        C = self._stumpff_C(z)
        S = self._stumpff_S(z)

        if not (math.isfinite(z) and math.isfinite(C) and math.isfinite(S)):
            return r0_vec, v0_vec

        f = 1.0 - (chi * chi / r0) * C
        g = dt_days - (chi * chi * chi / sqrt_mu) * S

        if not (math.isfinite(f) and math.isfinite(g)):
            return r0_vec, v0_vec

        r_vec = (
            f * r0_vec[0] + g * v0_vec[0],
            f * r0_vec[1] + g * v0_vec[1],
            f * r0_vec[2] + g * v0_vec[2],
        )
        r = self._norm3(r_vec)
        if r <= 0.0:
            return r_vec, v0_vec

        gdot = 1.0 - (chi * chi / r) * C
        fdot = (sqrt_mu / (r * r0)) * chi * (z * S - 1.0)

        v_vec = (
            fdot * r0_vec[0] + gdot * v0_vec[0],
            fdot * r0_vec[1] + gdot * v0_vec[1],
            fdot * r0_vec[2] + gdot * v0_vec[2],
        )

        return r_vec, v_vec

    def _compute_lambert_leg(
        self,
        source: str,
        target: str,
        t_depart: float,
        dt_days: float,
        *,
        prograde: bool,
        long_way: bool,
    ) -> Optional[TransferLeg]:
        t_depart = float(t_depart)
        dt_days = float(dt_days)
        if dt_days <= 0.0:
            return None

        t_arrive = t_depart + dt_days
        pos_depart = self._outer_parking_point(source, t_depart)
        pos_arrive = self._outer_parking_point(target, t_arrive)

        result = self._lambert_uv(pos_depart, pos_arrive, dt_days, prograde=prograde, long_way=long_way)
        if result is None:
            return None

        v_depart, v_arrive = result
        pos_check, _vel_check = self._propagate_two_body(pos_depart, v_depart, dt_days)
        if self._dist3(pos_check, pos_arrive) > 1e-4:
            return None

        return TransferLeg(
            source=source,
            target=target,
            t_depart=t_depart,
            t_arrive=t_arrive,
            duration=dt_days,
            pos_depart=pos_depart,
            pos_arrive=pos_arrive,
            vel_depart=v_depart,
            vel_arrive=v_arrive,
            prograde=prograde,
            long_way=long_way,
        )


    def _find_next_lambert_leg(self, source: str, target: str, earliest_time: float) -> TransferLeg:
        earliest = float(max(0.0, earliest_time))
        t_end = earliest + float(self.launch_scan_window_days)

        dt_guess = float(self._transfer_time_guess.get((source, target), 259.0))
        dt_min = float(getattr(self, 'lambert_dt_min_days', 180.0))
        dt_max = float(getattr(self, 'lambert_dt_max_days', 450.0))
        dt_step = float(getattr(self, 'lambert_dt_step_days', 5.0))
        dt_window = float(getattr(self, 'lambert_dt_window_days', 80.0))
        dv_budget = float(getattr(self, 'lambert_max_total_dv', 0.006))
        depart_window = float(getattr(self, 'lambert_depart_window_days', self.launch_refine_window_days))
        depart_step = float(getattr(self, 'lambert_depart_step_days', 2.0))
        coarse_step = float(getattr(self, 'lambert_phase_scan_step_days', 10.0))
        try_long_way = bool(getattr(self, 'lambert_try_long_way', False))

        if dt_step <= 0.0:
            dt_step = 5.0
        if dt_min <= 0.0:
            dt_min = 1.0
        if dt_max <= dt_min:
            dt_max = dt_min + dt_step
        if dt_window < 0.0:
            dt_window = 0.0
        if depart_step <= 0.0:
            depart_step = 2.0
        if coarse_step <= 0.0:
            coarse_step = 10.0

        p_source = float(self.planets[source].period)
        p_target = float(self.planets[target].period)
        denom = abs((1.0 / p_source) - (1.0 / p_target)) if p_source > 0.0 and p_target > 0.0 else 0.0
        synodic = (1.0 / denom) if denom > 0.0 else float(self.launch_scan_window_days)

        dt_start = max(dt_min, dt_guess - dt_window)
        dt_end = min(dt_max, dt_guess + dt_window)

        dt_candidates: list[float] = []
        k = 0
        while True:
            dt = dt_start + k * dt_step
            if dt > dt_end + 1e-12:
                break
            dt_candidates.append(dt)
            k += 1

        if not dt_candidates:
            dt_candidates = [max(dt_min, min(dt_max, dt_guess))]

        dt_candidates.sort(key=lambda d: abs(d - dt_guess))

        def phase_error(t_depart: float) -> float:
            pos_source = self.get_planet_position(source, t_depart)
            pos_target = self.get_planet_position(target, t_depart + dt_guess)
            theta_source = self._theta_xy(pos_source)
            theta_target = self._theta_xy(pos_target)
            return self._wrap_to_pi(theta_target - (theta_source + math.pi))

        def find_next_phase_root(t_start: float) -> Optional[float]:
            prev_t: Optional[float] = None
            prev_err: Optional[float] = None

            t = float(t_start)
            while t <= t_end + 1e-9:
                err = phase_error(t)
                if prev_t is not None and prev_err is not None:
                    if prev_err == 0.0:
                        return prev_t
                    if prev_err * err < 0 and abs(err - prev_err) < math.pi:
                        a = float(prev_t)
                        b = float(t)
                        err_a = float(prev_err)
                        for _ in range(60):
                            mid = 0.5 * (a + b)
                            err_mid = phase_error(mid)
                            if abs(err_mid) < 1e-8 or (b - a) < 1e-6:
                                return mid
                            if err_a * err_mid <= 0.0:
                                b = mid
                            else:
                                a = mid
                                err_a = err_mid
                        return 0.5 * (a + b)

                prev_t = t
                prev_err = err
                t += coarse_step

            return None

        center = find_next_phase_root(earliest)
        if center is None:
            center = earliest

        max_windows = int(math.ceil((t_end - earliest) / max(1e-6, synodic))) + 2

        for _ in range(max_windows):
            scan_start = max(earliest, center - depart_window)
            scan_end = min(t_end, center + depart_window)

            t_depart = float(scan_start)
            while t_depart <= scan_end + 1e-9:
                v_source = self.get_planet_velocity(source, t_depart)

                best_leg: Optional[TransferLeg] = None
                best_cost = float('inf')

                long_way_options = (False, True) if try_long_way else (False,)
                for dt in dt_candidates:
                    for long_way in long_way_options:
                        leg = self._compute_lambert_leg(source, target, t_depart, dt, prograde=True, long_way=long_way)
                        if leg is None:
                            continue

                        v_target = self.get_planet_velocity(target, leg.t_arrive)
                        dv1 = self._norm3(self._v3_sub(leg.vel_depart, v_source))
                        dv2 = self._norm3(self._v3_sub(leg.vel_arrive, v_target))
                        cost = dv1 + dv2
                        if cost > dv_budget:
                            continue

                        if not self._transfer_leg_clearance_ok(leg):
                            continue

                        if cost < best_cost:
                            best_cost = cost
                            best_leg = leg

                if best_leg is not None:
                    self._transfer_time_guess[(source, target)] = best_leg.duration
                    return best_leg

                t_depart += depart_step

            center += synodic

        raise RuntimeError(f"Failed to find Lambert transfer for {source}->{target} after day {earliest:.3f}")

    def _append_next_schedule(self) -> None:
        mission_index = len(self._schedules)
        t_start = 0.0 if mission_index == 0 else self._schedules[-1].leg_inbound.t_arrive

        leg_out = self._find_next_lambert_leg("earth", "mars", t_start)
        leg_in = self._find_next_lambert_leg("mars", "earth", leg_out.t_arrive)

        self._schedules.append(
            MissionSchedule(
                mission_index=mission_index,
                t_start=t_start,
                leg_outbound=leg_out,
                leg_inbound=leg_in,
            )
        )
        self._schedule_end_times.append(float(leg_in.t_arrive))



    def _ensure_schedules(self, time_days: float, *, lookahead_missions: int = 2) -> None:
        """Ensure schedules cover time_days and some lookahead missions for UI/slider."""
        t = float(max(0.0, time_days))

        while not self._schedules or self._schedules[-1].leg_inbound.t_arrive <= t:
            self._append_next_schedule()

        # Ensure we also have a few missions ahead of the current one.
        if len(self._schedule_end_times) != len(self._schedules):
            self._schedule_end_times = [float(s.leg_inbound.t_arrive) for s in self._schedules]

        current_index = bisect_right(self._schedule_end_times, t)
        while len(self._schedules) <= current_index + lookahead_missions:
            self._append_next_schedule()

    def _get_schedule_for_time(self, time_days: float) -> MissionSchedule:
        self._ensure_schedules(time_days, lookahead_missions=2)
        if len(self._schedule_end_times) != len(self._schedules):
            self._schedule_end_times = [float(s.leg_inbound.t_arrive) for s in self._schedules]

        t = float(max(0.0, time_days))
        idx = bisect_right(self._schedule_end_times, t)

        # If t lands exactly on the last end time, bisect_right returns len(ends).
        # Clamp to a valid schedule index to avoid IndexError.
        if idx >= len(self._schedules):
            idx = len(self._schedules) - 1

        return self._schedules[idx]

    def _get_transfer_position(self, leg: TransferLeg, time_days: float) -> Tuple[float, float, float]:
        if time_days <= leg.t_depart:
            return leg.pos_depart
        if time_days >= leg.t_arrive:
            return leg.pos_arrive

        dt = float(time_days) - float(leg.t_depart)
        pos, _vel = self._propagate_two_body(leg.pos_depart, leg.vel_depart, dt)
        return pos

    def get_mission_phase(self, time_days: float) -> Tuple[MissionPhase, int, float]:
        """
        获取当前任务阶段
        
        Returns:
            (phase, mission_number, time_in_mission)
            - phase: 任务阶段
            - mission_number: 第几次任务（从0开始）
            - time_in_mission: 在当前任务中的时间（[0, mission_duration)）
        """
        schedule = self._get_schedule_for_time(time_days)
        mission_number = schedule.mission_index
        time_in_mission = float(time_days - schedule.t_start)

        if time_days < schedule.leg_outbound.t_depart:
            phase = MissionPhase.EARTH_ORBIT_STAY
        elif time_days < schedule.leg_outbound.t_arrive:
            phase = MissionPhase.TRANSFER_TO_MARS
        elif time_days < schedule.leg_inbound.t_depart:
            phase = MissionPhase.MARS_ORBIT_STAY
        else:
            phase = MissionPhase.TRANSFER_TO_EARTH
        
        return (phase, mission_number, time_in_mission)

    def get_spacecraft_position(self, time_days: float) -> Tuple[float, float, float]:
        phase, mission_number, time_in_mission = self.get_mission_phase(time_days)
        schedule = self._get_schedule_for_time(time_days)

        if phase == MissionPhase.EARTH_ORBIT_STAY:
            earth_wait = schedule.leg_outbound.t_depart - schedule.t_start
            earth_period, _earth_revs = self._fit_parking_period(earth_wait, self.earth_parking_period_days)
            return self._parking_position(
                'earth',
                time_days,
                t_anchor=schedule.t_start,
                radius=self.earth_parking_r,
                period_days=earth_period,
            )

        if phase == MissionPhase.TRANSFER_TO_MARS:
            return self._get_transfer_position(schedule.leg_outbound, time_days)

        if phase == MissionPhase.MARS_ORBIT_STAY:
            mars_wait = schedule.leg_inbound.t_depart - schedule.leg_outbound.t_arrive
            mars_period, _mars_revs = self._fit_parking_period(mars_wait, self.mars_parking_period_days)
            return self._parking_position(
                'mars',
                time_days,
                t_anchor=schedule.leg_outbound.t_arrive,
                radius=self.mars_parking_r,
                period_days=mars_period,
            )

        if phase == MissionPhase.TRANSFER_TO_EARTH:
            return self._get_transfer_position(schedule.leg_inbound, time_days)

        raise RuntimeError(f"Unhandled mission phase: {phase}")

    def generate_orbit_points(self, planet: str, num_points: int = 360) -> List[Tuple[float, float, float]]:
        points = []
        period = self.planets[planet].period
        for i in range(num_points):
            t = (i / num_points) * period
            pos = self.get_planet_position(planet, t)
            points.append(pos)
        return points

    def calculate_distance(self, pos1: Tuple[float, float, float], pos2: Tuple[float, float, float]) -> float:
        return np.sqrt((pos1[0] - pos2[0])**2 + (pos1[1] - pos2[1])**2 + (pos1[2] - pos2[2])**2)

    def get_mission_info(self, time_days: float) -> Dict:
        time_days = float(max(0.0, time_days))
        earth_pos = self.get_planet_position('earth', time_days)
        mars_pos = self.get_planet_position('mars', time_days)
        ship_pos = self.get_spacecraft_position(time_days)
        
        phase, mission_number, time_in_mission = self.get_mission_phase(time_days)
        schedule = self._get_schedule_for_time(time_days)
        mission_duration = schedule.leg_inbound.t_arrive - schedule.t_start
        
        earth_velocity = self.get_planet_velocity('earth', time_days)
        mars_velocity = self.get_planet_velocity('mars', time_days)

        horizon_end = self._schedules[-1].leg_inbound.t_arrive if self._schedules else schedule.leg_inbound.t_arrive
        
        return {
            'time_days': time_days,
            'mission_number': mission_number,
            'phase': phase.value,
            'time_in_mission': time_in_mission,
            'mission_duration': mission_duration,
            'mission_schedule': {
                'mission_index': schedule.mission_index,
                't_start': schedule.t_start,
                't_launch_earth': schedule.leg_outbound.t_depart,
                't_arrival_mars': schedule.leg_outbound.t_arrive,
                't_depart_mars': schedule.leg_inbound.t_depart,
                't_arrival_earth': schedule.leg_inbound.t_arrive,
                'earth_wait': schedule.leg_outbound.t_depart - schedule.t_start,
                'mars_wait': schedule.leg_inbound.t_depart - schedule.leg_outbound.t_arrive,
                'transfer_earth_mars': schedule.leg_outbound.duration,
                'transfer_mars_earth': schedule.leg_inbound.duration,
            },
            'timeline_horizon_end': horizon_end,
            'earth_position': earth_pos,
            'mars_position': mars_pos,
            'spacecraft_position': ship_pos,
            'earth_mars_distance': self.calculate_distance(earth_pos, mars_pos),
            'earth_velocity': earth_velocity,
            'mars_velocity': mars_velocity,
            'progress': 0.0 if mission_duration <= 0 else max(0.0, min(1.0, time_in_mission / mission_duration))
        }

    def get_schedule_preview(self, num_missions: int = 3) -> List[Dict]:
        """Return a preview of upcoming missions (for UI initialization)."""
        if num_missions <= 0:
            return []
        self._ensure_schedules(0.0, lookahead_missions=max(0, num_missions - 1))
        preview = []
        for schedule in self._schedules[:num_missions]:
            preview.append(
                {
                    'mission_index': schedule.mission_index,
                    't_start': schedule.t_start,
                    't_launch_earth': schedule.leg_outbound.t_depart,
                    't_arrival_mars': schedule.leg_outbound.t_arrive,
                    't_depart_mars': schedule.leg_inbound.t_depart,
                    't_arrival_earth': schedule.leg_inbound.t_arrive,
                    'mission_duration': schedule.leg_inbound.t_arrive - schedule.t_start,
                    'earth_wait': schedule.leg_outbound.t_depart - schedule.t_start,
                    'mars_wait': schedule.leg_inbound.t_depart - schedule.leg_outbound.t_arrive,
                    'transfer_earth_mars': schedule.leg_outbound.duration,
                    'transfer_mars_earth': schedule.leg_inbound.duration,
                }
            )
        return preview
