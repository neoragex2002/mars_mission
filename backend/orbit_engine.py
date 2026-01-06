import numpy as np
from typing import Dict, Tuple, List
from dataclasses import dataclass
from enum import Enum

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
        
        # Mission parameters
        self.transfer_time_earth_mars = 259  # days
        self.transfer_time_mars_earth = 259  # days
        self.mars_wait_time = 454  # days
        self.earth_launch_wait_time = 30  # days
        
        # Single mission timeline
        self.single_mission_duration = (
            self.earth_launch_wait_time +
            self.transfer_time_earth_mars +
            self.mars_wait_time +
            self.transfer_time_mars_earth
        )
        
        # Pre-compute transfer orbit interpolation tables
        self._build_transfer_interpolation()

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

    def _build_transfer_interpolation(self):
        """构建转移轨道的插值表（用于任意时刻的转移计算）"""
        # 这个方法不再预计算固定插值表
        # 而是提供一个基于时间的动态计算方法
        pass

    def _get_transfer_position(self, t_start: float, t_end: float, 
                             pos_start: Tuple[float, float, float],
                             pos_end: Tuple[float, float, float],
                             time_days: float, 
                             direction: str) -> Tuple[float, float, float]:
        """
        动态计算转移轨道位置
        
        Args:
            t_start: 转移开始时间
            t_end: 转移结束时间
            pos_start: 转移起点位置
            pos_end: 转移终点位置
            time_days: 当前时间
            direction: 'outward' (地球->火星) 或 'inward' (火星->地球)
        """
        # 进度 [0, 1]
        progress = (time_days - t_start) / (t_end - t_start)
        progress = np.clip(progress, 0.0, 1.0)
        
        # 起点和终点的极坐标
        r_start = np.sqrt(pos_start[0]**2 + pos_start[1]**2)
        r_end = np.sqrt(pos_end[0]**2 + pos_end[1]**2)
        theta_start = np.arctan2(pos_start[1], pos_start[0])
        theta_end = np.arctan2(pos_end[1], pos_end[0])
        
        # 选择最短的角度路径
        delta_theta = theta_end - theta_start
        while delta_theta < -np.pi:
            delta_theta += 2 * np.pi
        while delta_theta > np.pi:
            delta_theta -= 2 * np.pi
        
        # 当前角度
        theta_current = theta_start + delta_theta * progress
        
        # 当前半径（使用平滑曲线）
        # 根据方向添加凸起或凹陷
        if direction == 'outward':
            bulge = 0.12 * np.sin(progress * np.pi)  # 向外凸起
        else:
            bulge = -0.08 * np.sin(progress * np.pi)  # 向内凹陷
        
        r_current = r_start + (r_end - r_start) * progress + bulge
        
        # Z坐标线性插值
        z = pos_start[2] + (pos_end[2] - pos_start[2]) * progress
        
        # 转换为笛卡尔坐标
        x = r_current * np.cos(theta_current)
        y = r_current * np.sin(theta_current)
        
        # 确保端点精确匹配
        if progress <= 1e-10:
            x, y, z = pos_start
        elif progress >= 1 - 1e-10:
            x, y, z = pos_end
        
        return (x, y, z)

    def get_mission_phase(self, time_days: float) -> Tuple[MissionPhase, int, float]:
        """
        获取当前任务阶段
        
        Returns:
            (phase, mission_number, time_in_mission)
            - phase: 任务阶段
            - mission_number: 第几次任务（从0开始）
            - time_in_mission: 在当前任务中的时间（[0, single_mission_duration)）
        """
        # 计算第几次任务
        mission_number = int(time_days // self.single_mission_duration)
        
        # 计算在当前任务中的时间
        time_in_mission = time_days % self.single_mission_duration
        
        t_launch_wait_start = 0
        t_launch_wait_end = self.earth_launch_wait_time
        t_launch = t_launch_wait_end
        t_arrival_mars = t_launch + self.transfer_time_earth_mars
        t_departure_mars = t_arrival_mars + self.mars_wait_time
        t_arrival_earth = t_departure_mars + self.transfer_time_mars_earth
        
        if time_in_mission < t_launch_wait_end:
            phase = MissionPhase.PRE_LAUNCH
        elif time_in_mission < t_arrival_mars:
            phase = MissionPhase.TRANSFER_TO_MARS
        elif time_in_mission < t_departure_mars:
            phase = MissionPhase.ON_MARS
        else:
            phase = MissionPhase.TRANSFER_TO_EARTH
        
        return (phase, mission_number, time_in_mission)

    def get_spacecraft_position(self, time_days: float) -> Tuple[float, float, float]:
        phase, mission_number, time_in_mission = self.get_mission_phase(time_days)
        
        mission_start_time = mission_number * self.single_mission_duration
        
        t_launch = mission_start_time + self.earth_launch_wait_time
        t_arrival_mars = t_launch + self.transfer_time_earth_mars
        t_departure_mars = t_arrival_mars + self.mars_wait_time
        t_arrival_earth = t_departure_mars + self.transfer_time_mars_earth
        
        if phase == MissionPhase.PRE_LAUNCH:
            return self.get_planet_position('earth', time_days)
            
        elif phase == MissionPhase.TRANSFER_TO_MARS:
            # 地球 -> 火星转移
            pos_start = self.get_planet_position('earth', t_launch)
            pos_end = self.get_planet_position('mars', t_arrival_mars)
            return self._get_transfer_position(t_launch, t_arrival_mars, 
                                             pos_start, pos_end, 
                                             time_days, 'outward')
            
        elif phase == MissionPhase.ON_MARS:
            # 飞船在火星上
            return self.get_planet_position('mars', time_days)
            
        elif phase == MissionPhase.TRANSFER_TO_EARTH:
            # 火星 -> 地球转移
            pos_start = self.get_planet_position('mars', t_departure_mars)
            pos_end = self.get_planet_position('earth', t_arrival_earth)
            return self._get_transfer_position(t_departure_mars, t_arrival_earth, 
                                             pos_start, pos_end, 
                                             time_days, 'inward')
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
        earth_pos = self.get_planet_position('earth', time_days)
        mars_pos = self.get_planet_position('mars', time_days)
        ship_pos = self.get_spacecraft_position(time_days)
        
        phase, mission_number, time_in_mission = self.get_mission_phase(time_days)
        
        earth_velocity = self.get_planet_velocity('earth', time_days)
        mars_velocity = self.get_planet_velocity('mars', time_days)
        
        return {
            'time_days': time_days,
            'mission_number': mission_number,
            'phase': phase.value,
            'earth_position': earth_pos,
            'mars_position': mars_pos,
            'spacecraft_position': ship_pos,
            'earth_mars_distance': self.calculate_distance(earth_pos, mars_pos),
            'earth_velocity': earth_velocity,
            'mars_velocity': mars_velocity,
            'progress': min(1.0, time_in_mission / self.single_mission_duration)
        }
