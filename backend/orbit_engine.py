import math
from bisect import bisect_right
from dataclasses import dataclass
from enum import Enum
from typing import Dict, Tuple, List, Optional

import numpy as np

class MissionPhase(Enum):
    PRE_LAUNCH = "pre_launch"
    TRANSFER_TO_MARS = "transfer_to_mars"
    ON_MARS = "on_mars"
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
    r_depart_xy: float
    r_arrive_xy: float
    a: float
    e: float
    p: float
    n: float  # Mean motion (rad/day)
    theta_depart: float  # atan2(y, x) at departure (rad)
    theta_target_arrive: float  # atan2(y, x) of target at arrival (rad)
    theta_peri: float  # Inertial angle of periapsis direction (rad)
    M0: float  # Mean anomaly offset at departure (rad)
    pos_depart: Tuple[float, float, float]
    pos_arrive: Tuple[float, float, float]

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

        # Launch window search / refinement settings.
        self.launch_scan_window_days = 1400.0
        self.launch_coarse_step_days = 2.0
        self.launch_refine_window_days = 80.0
        self.launch_refine_step_days = 0.5

        # Self-consistent transfer-time iteration settings.
        self.transfer_time_tol_days = 1e-6
        self.transfer_time_max_iter = 20

        # Initial transfer-time guesses (used for coarse scanning).
        self._transfer_time_guess: dict[tuple[str, str], float] = {
            ("earth", "mars"): 259.0,
            ("mars", "earth"): 259.0,
        }

        # Dynamic mission schedules (generated on demand).
        self._schedules: list[MissionSchedule] = []

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

    @staticmethod
    def _solve_kepler_E(M_rad: float, e: float, tol: float = 1e-12, max_iter: int = 50) -> float:
        """Solve M = E - e*sin(E) for E (radians)."""
        M = M_rad % (2 * math.pi)
        E = M if e < 0.8 else math.pi
        for _ in range(max_iter):
            f = E - e * math.sin(E) - M
            fp = 1 - e * math.cos(E)
            if fp == 0:
                break
            d = f / fp
            E -= d
            if abs(d) < tol:
                break
        return E

    @staticmethod
    def _true_anomaly_from_E(E_rad: float, e: float) -> float:
        """Compute true anomaly ν in [0, 2π) from eccentric anomaly E (radians)."""
        sin_E = math.sin(E_rad)
        cos_E = math.cos(E_rad)
        denom = 1 - e * cos_E
        if denom == 0:
            denom = 1e-15
        sin_nu = math.sqrt(max(0.0, 1 - e * e)) * sin_E / denom
        cos_nu = (cos_E - e) / denom
        nu = math.atan2(sin_nu, cos_nu)
        if nu < 0:
            nu += 2 * math.pi
        return nu

    def _compute_transfer_leg(
        self,
        source: str,
        target: str,
        t_depart: float,
        t_guess: Optional[float] = None,
        *,
        max_iter: Optional[int] = None,
        tol_days: Optional[float] = None,
    ) -> TransferLeg:
        """Compute a prograde Hohmann-style half-ellipse leg in the x-y projection plane.

        - Uses instantaneous projected radii r_xy at departure and at arrival (self-consistent).
        - The in-plane motion is a strict Kepler ellipse segment (half-ellipse).
        - z is not part of the ellipse; spacecraft z is later interpolated between endpoints.
        """
        t_depart = float(t_depart)
        pos_depart = self.get_planet_position(source, t_depart)
        theta_depart = self._theta_xy(pos_depart)
        r_depart = self._r_xy(pos_depart)

        guess = float(t_guess) if t_guess is not None else self._transfer_time_guess.get((source, target), 259.0)
        max_iter = self.transfer_time_max_iter if max_iter is None else int(max_iter)
        tol_days = self.transfer_time_tol_days if tol_days is None else float(tol_days)

        T = max(1e-6, guess)
        for _ in range(max_iter):
            pos_target = self.get_planet_position(target, t_depart + T)
            r_arrive = self._r_xy(pos_target)
            a = (r_depart + r_arrive) / 2.0
            T_new = math.pi * math.sqrt((a ** 3) / self.mu_sun)
            if abs(T_new - T) < tol_days:
                T = T_new
                break
            T = T_new

        t_arrive = t_depart + T
        pos_arrive = self.get_planet_position(target, t_arrive)
        r_arrive = self._r_xy(pos_arrive)
        theta_target_arrive = self._theta_xy(pos_arrive)

        a = (r_depart + r_arrive) / 2.0
        r_peri = min(r_depart, r_arrive)
        r_apo = max(r_depart, r_arrive)
        e = 0.0 if (r_peri + r_apo) == 0 else (r_apo - r_peri) / (r_apo + r_peri)
        p = a * (1 - e * e)
        n = math.sqrt(self.mu_sun / (a ** 3))  # rad/day

        # Outward (peri -> apo) vs inward (apo -> peri), both prograde.
        if r_arrive >= r_depart:
            theta_peri = theta_depart
            M0 = 0.0
        else:
            theta_peri = theta_depart + math.pi
            M0 = math.pi

        return TransferLeg(
            source=source,
            target=target,
            t_depart=t_depart,
            t_arrive=t_arrive,
            duration=T,
            r_depart_xy=r_depart,
            r_arrive_xy=r_arrive,
            a=a,
            e=e,
            p=p,
            n=n,
            theta_depart=theta_depart,
            theta_target_arrive=theta_target_arrive,
            theta_peri=theta_peri,
            M0=M0,
            pos_depart=pos_depart,
            pos_arrive=pos_arrive,
        )

    def _transfer_angle_error(
        self,
        source: str,
        target: str,
        t_depart: float,
        *,
        t_guess: Optional[float] = None,
        full_iter: bool = True,
    ) -> Tuple[float, TransferLeg]:
        """Angle error for the 'half-ellipse advances π' condition (in x-y projection)."""
        leg = self._compute_transfer_leg(
            source,
            target,
            t_depart,
            t_guess=t_guess,
            max_iter=self.transfer_time_max_iter if full_iter else 3,
            tol_days=self.transfer_time_tol_days if full_iter else 1e-3,
        )
        err = self._wrap_to_pi(leg.theta_target_arrive - (leg.theta_depart + math.pi))
        return err, leg

    def _find_next_transfer_leg(self, source: str, target: str, earliest_time: float) -> TransferLeg:
        """Find the next prograde Hohmann-like leg start time >= earliest_time."""
        earliest = float(max(0.0, earliest_time))
        t_guess = self._transfer_time_guess.get((source, target), 259.0)
        t_end = earliest + self.launch_scan_window_days
        step = self.launch_coarse_step_days

        # 1) Sequential coarse scan using the (cheap) self-consistent transfer time.
        #    We want the *earliest* true root, not just the smallest approximate error.
        best_t = earliest
        best_abs = float("inf")
        bracket: Optional[Tuple[float, float]] = None
        prev_t: Optional[float] = None
        prev_err: Optional[float] = None

        t = earliest
        while t <= t_end + 1e-9:
            err, leg = self._transfer_angle_error(source, target, t, t_guess=t_guess, full_iter=False)
            t_guess = leg.duration  # warm-start across the scan

            abs_err = abs(err)
            if abs_err < best_abs:
                best_abs = abs_err
                best_t = t

            if prev_t is not None and prev_err is not None:
                if prev_err == 0.0:
                    bracket = (prev_t, prev_t)
                    break
                if prev_err * err < 0 and abs(err - prev_err) < math.pi:
                    bracket = (prev_t, t)
                    break

            prev_t = t
            prev_err = err
            t += step

        # 2) Validate coarse bracket against the full model (guard against false sign changes).
        if bracket is not None:
            a, b = bracket
            verify_guess = self._transfer_time_guess.get((source, target), 259.0)
            if a == b:
                err_a, _ = self._transfer_angle_error(source, target, a, t_guess=verify_guess, full_iter=True)
                if abs(err_a) > 1e-6:
                    best_t = a
                    bracket = None
            else:
                err_a, leg_a = self._transfer_angle_error(source, target, a, t_guess=verify_guess, full_iter=True)
                err_b, _ = self._transfer_angle_error(source, target, b, t_guess=leg_a.duration, full_iter=True)
                if not (err_a == 0.0 or err_b == 0.0 or (err_a * err_b < 0 and abs(err_b - err_a) < math.pi)):
                    best_t = (a + b) / 2.0
                    bracket = None

        # 3) If no valid bracket was found, refine locally around the best sample (expand if needed).
        if bracket is None:
            refine_step = self.launch_refine_step_days
            refine_window = self.launch_refine_window_days

            for _ in range(6):  # Expand a few times if needed.
                t0 = max(earliest, best_t - refine_window)
                t1 = best_t + refine_window

                times: list[float] = []
                errors: list[float] = []

                local_guess = self._transfer_time_guess.get((source, target), 259.0)
                cur = t0
                while cur <= t1 + 1e-9:
                    err, leg = self._transfer_angle_error(source, target, cur, t_guess=local_guess, full_iter=True)
                    local_guess = leg.duration
                    times.append(cur)
                    errors.append(err)
                    cur += refine_step

                for i in range(len(times) - 1):
                    e0 = errors[i]
                    e1 = errors[i + 1]
                    if e0 == 0.0:
                        bracket = (times[i], times[i])
                        break
                    if e0 * e1 < 0 and abs(e1 - e0) < math.pi:
                        bracket = (times[i], times[i + 1])
                        break

                if bracket is not None:
                    break
                refine_window *= 2.0

        if bracket is None:
            raise RuntimeError(f"Failed to find launch window for {source}->{target} after day {earliest:.3f}")

        a, b = bracket
        if a == b:
            _, leg = self._transfer_angle_error(source, target, a, t_guess=t_guess, full_iter=True)
            self._transfer_time_guess[(source, target)] = leg.duration
            return leg

        # 3) Bisection refine.
        err_a, leg_a = self._transfer_angle_error(source, target, a, t_guess=t_guess, full_iter=True)
        t_guess = leg_a.duration
        err_b, leg_b = self._transfer_angle_error(source, target, b, t_guess=t_guess, full_iter=True)
        t_guess = leg_b.duration

        for _ in range(60):
            mid = (a + b) / 2.0
            err_mid, leg_mid = self._transfer_angle_error(source, target, mid, t_guess=t_guess, full_iter=True)
            t_guess = leg_mid.duration

            if abs(err_mid) < 1e-10 or (b - a) < 1e-6:
                self._transfer_time_guess[(source, target)] = leg_mid.duration
                return leg_mid

            if err_a * err_mid <= 0:
                b = mid
                err_b = err_mid
            else:
                a = mid
                err_a = err_mid

        _, leg = self._transfer_angle_error(source, target, (a + b) / 2.0, t_guess=t_guess, full_iter=True)
        self._transfer_time_guess[(source, target)] = leg.duration
        return leg

    def _append_next_schedule(self) -> None:
        mission_index = len(self._schedules)
        t_start = 0.0 if mission_index == 0 else self._schedules[-1].leg_inbound.t_arrive

        leg_out = self._find_next_transfer_leg("earth", "mars", t_start)
        leg_in = self._find_next_transfer_leg("mars", "earth", leg_out.t_arrive)

        self._schedules.append(
            MissionSchedule(
                mission_index=mission_index,
                t_start=t_start,
                leg_outbound=leg_out,
                leg_inbound=leg_in,
            )
        )

    def _ensure_schedules(self, time_days: float, *, lookahead_missions: int = 2) -> None:
        """Ensure schedules cover time_days and some lookahead missions for UI/slider."""
        t = float(max(0.0, time_days))

        while not self._schedules or self._schedules[-1].leg_inbound.t_arrive <= t:
            self._append_next_schedule()

        # Ensure we also have a few missions ahead of the current one.
        ends = [s.leg_inbound.t_arrive for s in self._schedules]
        current_index = bisect_right(ends, t)
        while len(self._schedules) <= current_index + lookahead_missions:
            self._append_next_schedule()

    def _get_schedule_for_time(self, time_days: float) -> MissionSchedule:
        self._ensure_schedules(time_days, lookahead_missions=2)
        ends = [s.leg_inbound.t_arrive for s in self._schedules]
        t = float(max(0.0, time_days))
        idx = bisect_right(ends, t)

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

        tau = float(time_days - leg.t_depart)
        M = leg.M0 + leg.n * tau
        E = self._solve_kepler_E(M, leg.e)
        nu = self._true_anomaly_from_E(E, leg.e)

        r = leg.a * (1 - leg.e * math.cos(E))
        theta = leg.theta_peri + nu

        x = r * math.cos(theta)
        y = r * math.sin(theta)

        progress = tau / leg.duration if leg.duration > 0 else 0.0
        z = leg.pos_depart[2] + (leg.pos_arrive[2] - leg.pos_depart[2]) * progress

        return (x, y, z)

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
            phase = MissionPhase.PRE_LAUNCH
        elif time_days < schedule.leg_outbound.t_arrive:
            phase = MissionPhase.TRANSFER_TO_MARS
        elif time_days < schedule.leg_inbound.t_depart:
            phase = MissionPhase.ON_MARS
        else:
            phase = MissionPhase.TRANSFER_TO_EARTH
        
        return (phase, mission_number, time_in_mission)

    def get_spacecraft_position(self, time_days: float) -> Tuple[float, float, float]:
        phase, mission_number, time_in_mission = self.get_mission_phase(time_days)
        schedule = self._get_schedule_for_time(time_days)

        if phase == MissionPhase.PRE_LAUNCH:
            return self.get_planet_position('earth', time_days)
            
        elif phase == MissionPhase.TRANSFER_TO_MARS:
            return self._get_transfer_position(schedule.leg_outbound, time_days)
            
        elif phase == MissionPhase.ON_MARS:
            return self.get_planet_position('mars', time_days)
            
        elif phase == MissionPhase.TRANSFER_TO_EARTH:
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
