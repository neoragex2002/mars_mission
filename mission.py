import numpy as np
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d import Axes3D
import matplotlib.animation as animation

# --- Constants ---
AU = 1.496e11  # Astronomical Unit in meters (Informational, not directly used in AU plots)
DAY_S = 24 * 3600  # Seconds in a day (Informational)

# Orbital parameters (simplified - circular orbits in AU)
EARTH_RADIUS_AU = 1.0
MARS_RADIUS_AU = 1.524
EARTH_PERIOD_DAYS = 365.25
MARS_PERIOD_DAYS = 687.0

# --- Simulation Parameters ---
# Travel times (approximate for Hohmann-like transfers)
EARTH_MARS_TRAVEL_DAYS = 250
MARS_EARTH_TRAVEL_DAYS = 250 # Similar duration for return

# Wait time on Mars (needs to be long enough for planets to realign - near synodic period)
# Mars synodic period is ~780 days. Wait needs to accommodate this + phasing.
MARS_WAIT_DAYS = 450 # An example wait time

# Total simulation time - THIS CALCULATION IS CORRECT
TOTAL_TRIP_DURATION_DAYS = EARTH_MARS_TRAVEL_DAYS + MARS_WAIT_DAYS + MARS_EARTH_TRAVEL_DAYS
SIMULATION_STEP_DAYS = 5  # Time step for calculation (adjust for speed vs smoothness)
ANIMATION_FRAMES = int(TOTAL_TRIP_DURATION_DAYS / SIMULATION_STEP_DAYS)
ANIMATION_INTERVAL_MS = 30 # milliseconds per frame (adjust animation speed)

# --- Helper Functions ---

def get_planet_position(radius_au, period_days, time_days):
    """Calculates planet position on a circular orbit in the XY plane."""
    # Ensure time_days is non-negative for calculation stability
    time_days = max(time_days, 0)
    angle = 2 * np.pi * (time_days / period_days)
    x = radius_au * np.cos(angle)
    y = radius_au * np.sin(angle)
    z = 0.0
    return np.array([x, y, z])

def get_transfer_orbit_point(r1_au, r2_au, phase, start_pos, end_pos_at_arrival):
    """
    Calculates a point on a simplified transfer ellipse segment between two orbits.
    phase is normalized time, 0 (start) to 1 (end).
    start_pos is the actual starting position vector.
    end_pos_at_arrival is the calculated position vector of the target planet at the arrival time.
    This uses geometric interpolation of angle and an approximate elliptical radius.
    """
    # Ensure phase is clipped between 0 and 1
    phase = np.clip(phase, 0.0, 1.0)

    # Calculate semi-major axis of the theoretical Hohmann transfer ellipse
    a = (r1_au + r2_au) / 2.0

    # Calculate start and end angles relative to the Sun (origin)
    start_angle = np.arctan2(start_pos[1], start_pos[0])
    end_angle_target = np.arctan2(end_pos_at_arrival[1], end_pos_at_arrival[0])

    # Handle angle wrapping for correct interpolation
    delta_angle = end_angle_target - start_angle
    if delta_angle > np.pi:
        delta_angle -= 2 * np.pi
    elif delta_angle < -np.pi:
        delta_angle += 2 * np.pi

    # Interpolate the current angle
    current_angle = start_angle + phase * delta_angle

    # Calculate eccentricity based on perihelion/aphelion
    if r1_au < r2_au: # Moving outwards (e.g., Earth to Mars)
        rp = r1_au # Perihelion radius
        ra = r2_au # Aphelion radius
    else: # Moving inwards (e.g., Mars to Earth)
        rp = r2_au
        ra = r1_au
    c = (ra - rp) / 2.0 # Distance from center to focus
    ecc = c / a       # Eccentricity

    # Approximate the radius using the polar equation of an ellipse.
    # This part is a simplification, assuming the transfer is roughly half an ellipse
    # and aligning its axis approximately with the start/end points for visual purposes.
    # 'theta' in the polar equation is angle from periapsis. We approximate this.
    if r1_au < r2_au: # Outward: phase 0 -> periapsis, phase 1 -> apoapsis
        relative_angle_from_periapsis = phase * np.pi
    else: # Inward: phase 0 -> apoapsis, phase 1 -> periapsis
        relative_angle_from_periapsis = (1 - phase) * np.pi # Angle decreases from pi to 0

    # Polar equation: r = a(1-e^2) / (1 + e*cos(theta))
    denominator = (1 + ecc * np.cos(relative_angle_from_periapsis))
    # Avoid division by zero or very small numbers
    if abs(denominator) < 1e-9:
        denominator = 1e-9 if denominator >= 0 else -1e-9

    r = a * (1 - ecc**2) / denominator

    # Clamp radius to be between the start and end radii, preventing numerical issues
    r = np.clip(r, min(r1_au, r2_au), max(r1_au, r2_au))

    # Calculate Cartesian coordinates
    x = r * np.cos(current_angle)
    y = r * np.sin(current_angle)
    z = 0.0 # Keep motion in the XY plane
    return np.array([x, y, z])

# --- Setup Plot ---
fig = plt.figure(figsize=(10, 10))
ax = fig.add_subplot(111, projection='3d')
ax.set_facecolor('black')
fig.patch.set_facecolor('black') # Set figure background color as well

# Plot Sun
ax.scatter([0], [0], [0], color='yellow', s=200, label='Sun', marker='o') # Explicit marker

# Plot full orbits (more points for smoother circle)
orbit_angles = np.linspace(0, 2 * np.pi, 300)
earth_orbit_x = EARTH_RADIUS_AU * np.cos(orbit_angles)
earth_orbit_y = EARTH_RADIUS_AU * np.sin(orbit_angles)
mars_orbit_x = MARS_RADIUS_AU * np.cos(orbit_angles)
mars_orbit_y = MARS_RADIUS_AU * np.sin(orbit_angles)
ax.plot(earth_orbit_x, earth_orbit_y, [0]*300, color='deepskyblue', linestyle='--', linewidth=0.8, label='Earth Orbit', alpha=0.7)
ax.plot(mars_orbit_x, mars_orbit_y, [0]*300, color='orangered', linestyle='--', linewidth=0.8, label='Mars Orbit', alpha=0.7)

# Initialize plot elements for animation
# Use `plot` which returns a list containing the Line3D object; trailing comma unpacks it.
earth_pos_marker, = ax.plot([], [], [], 'o', color='blue', markersize=7, label='Earth')
mars_pos_marker, = ax.plot([], [], [], 'o', color='red', markersize=6, label='Mars')
ship_pos_marker, = ax.plot([], [], [], 'o', color='lime', markersize=5, label='Spacecraft')
ship_trajectory_line, = ax.plot([], [], [], '-', color='lime', linewidth=1.5, alpha=0.8) # Slightly thicker line

# Store trajectory points
ship_trajectory_points = []

# --- Define Simulation Timeline & Key Positions ---
t_launch_earth = 0
t_arrival_mars = t_launch_earth + EARTH_MARS_TRAVEL_DAYS
t_launch_mars = t_arrival_mars + MARS_WAIT_DAYS
t_arrival_earth = t_launch_mars + MARS_EARTH_TRAVEL_DAYS

# Calculate planet positions AT THE KEY MOMENTS for transfer calculations
# These are the *targets* for the transfer orbit function
earth_pos_at_launch = get_planet_position(EARTH_RADIUS_AU, EARTH_PERIOD_DAYS, t_launch_earth)
mars_pos_at_arrival = get_planet_position(MARS_RADIUS_AU, MARS_PERIOD_DAYS, t_arrival_mars)

mars_pos_at_return_launch = get_planet_position(MARS_RADIUS_AU, MARS_PERIOD_DAYS, t_launch_mars)
earth_pos_at_return_arrival = get_planet_position(EARTH_RADIUS_AU, EARTH_PERIOD_DAYS, t_arrival_earth)

# --- Animation Function ---
def update(frame):
    current_time_days = frame * SIMULATION_STEP_DAYS

    # Calculate current planet positions for this frame
    earth_pos = get_planet_position(EARTH_RADIUS_AU, EARTH_PERIOD_DAYS, current_time_days)
    mars_pos = get_planet_position(MARS_RADIUS_AU, MARS_PERIOD_DAYS, current_time_days)

    # Determine spacecraft phase and calculate position
    ship_pos = None # Initialize ship_pos
    current_phase_label = ""

    # Determine current phase and spacecraft position
    if current_time_days < t_arrival_mars:
        # Phase 1: Earth -> Mars Transfer
        phase = (current_time_days - t_launch_earth) / EARTH_MARS_TRAVEL_DAYS
        ship_pos = get_transfer_orbit_point(
            EARTH_RADIUS_AU, MARS_RADIUS_AU, phase,
            earth_pos_at_launch, mars_pos_at_arrival
        )
        current_phase_label = "Phase: Earth to Mars Transfer"
        if not ship_trajectory_points or not np.allclose(ship_pos, ship_trajectory_points[-1]):
             ship_trajectory_points.append(ship_pos)
    elif current_time_days < t_launch_mars:
        # Phase 2: Waiting on Mars surface (follow Mars)
        ship_pos = mars_pos
        wait_elapsed = current_time_days - t_arrival_mars
        current_phase_label = f"Phase: On Mars ({wait_elapsed:.0f} / {MARS_WAIT_DAYS} days wait)"
        # Append position only once when arriving or if Mars moves significantly between frames
        if not ship_trajectory_points or not np.allclose(ship_pos, ship_trajectory_points[-1]):
             ship_trajectory_points.append(ship_pos)
    elif current_time_days <= t_arrival_earth:
        # Phase 3: Mars -> Earth Transfer
        phase = (current_time_days - t_launch_mars) / MARS_EARTH_TRAVEL_DAYS
        ship_pos = get_transfer_orbit_point(
            MARS_RADIUS_AU, EARTH_RADIUS_AU, phase,
            mars_pos_at_return_launch, earth_pos_at_return_arrival
        )
        current_phase_label = "Phase: Mars to Earth Transfer"
        if not ship_trajectory_points or not np.allclose(ship_pos, ship_trajectory_points[-1]):
             ship_trajectory_points.append(ship_pos)
    else:
        # Phase 4: Arrived back at Earth (follow Earth)
        ship_pos = earth_pos
        current_phase_label = "Phase: Journey Complete (at Earth)"
         # Append position only once when arriving or if Earth moves significantly
        if not ship_trajectory_points or not np.allclose(ship_pos, ship_trajectory_points[-1]):
             ship_trajectory_points.append(ship_pos)


    # Update plot data for markers
    earth_pos_marker.set_data_3d([earth_pos[0]], [earth_pos[1]], [earth_pos[2]])
    mars_pos_marker.set_data_3d([mars_pos[0]], [mars_pos[1]], [mars_pos[2]])
    if ship_pos is not None:
        ship_pos_marker.set_data_3d([ship_pos[0]], [ship_pos[1]], [ship_pos[2]])

    # Update trajectory line data
    if len(ship_trajectory_points) > 1:
        traj_array = np.array(ship_trajectory_points)
        ship_trajectory_line.set_data_3d(traj_array[:, 0], traj_array[:, 1], traj_array[:, 2])
    elif len(ship_trajectory_points) == 1:
         ship_trajectory_line.set_data_3d([ship_trajectory_points[0][0]], [ship_trajectory_points[0][1]], [ship_trajectory_points[0][2]])

    # Update title with current time and phase - THE VARIABLE IS ACCESSED CORRECTLY HERE
    title_text = (f"Earth-Mars Round Trip Simulation\n"
                  f"Day: {current_time_days:.0f} / {TOTAL_TRIP_DURATION_DAYS:.0f}\n"
                  f"{current_phase_label}")
    ax.set_title(title_text, color='white', fontsize=10) # This updates the title object

    # Return tuple of updated artists for blitting (if enabled)
    # Note: Title object is NOT returned, hence blit=True causes issues with title updates.
    return earth_pos_marker, mars_pos_marker, ship_pos_marker, ship_trajectory_line

# --- Setup Axes and Legend ---
max_radius = MARS_RADIUS_AU * 1.2 # Set plot limits slightly larger than Mars orbit
ax.set_xlim([-max_radius, max_radius])
ax.set_ylim([-max_radius, max_radius])
ax.set_zlim([-max_radius, max_radius]) # Keep Z symmetric for better view, even if motion is 2D

# Set labels and ticks colors
ax.set_xlabel("X (AU)", color='white', labelpad=10)
ax.set_ylabel("Y (AU)", color='white', labelpad=10)
ax.set_zlabel("Z (AU)", color='white', labelpad=10)
ax.tick_params(axis='x', colors='white')
ax.tick_params(axis='y', colors='white')
ax.tick_params(axis='z', colors='white')

# Customize grid and panes color
ax.xaxis.pane.fill = False
ax.yaxis.pane.fill = False
ax.zaxis.pane.fill = False
ax.xaxis.pane.set_edgecolor('dimgray') # Darker gray for panes
ax.yaxis.pane.set_edgecolor('dimgray')
ax.zaxis.pane.set_edgecolor('dimgray')
ax.grid(color='gray', linestyle=':', linewidth=0.5)

# Setup Legend
legend = ax.legend(facecolor='darkslategray', labelcolor='white', fontsize=8, loc='upper right')
for text in legend.get_texts():
    text.set_color("white") # Ensure legend text is white

# Set initial view angle (elevation, azimuth)
ax.view_init(elev=25., azim=45)

# --- Create and Run Animation ---
# Adjust 'frames' if needed, ensure it covers the full duration
# *** CHANGE: Set blit=False to ensure the title text updates correctly ***
ani = animation.FuncAnimation(
    fig=fig,
    func=update,
    frames=ANIMATION_FRAMES + 1, # Include the final frame
    interval=ANIMATION_INTERVAL_MS,
    blit=False,  # <--- Set to False to fix title update issue
    repeat=False # Do not loop the animation
)

# To display the animation window:
try:
    plt.show()
except Exception as e:
    print(f"Could not display plot: {e}")
    print("Ensure you have a graphical backend configured for matplotlib (e.g., TkAgg, Qt5Agg).")


# To save the animation (requires ffmpeg or other writer installed):
# print("Attempting to save animation... This might take a while.")
# try:
#     ani.save('earth_mars_round_trip.mp4', writer='ffmpeg', fps=30, dpi=150, progress_callback=lambda i, n: print(f'Saving frame {i+1}/{n}', end='\r'))
#     print("\nAnimation saved as earth_mars_round_trip.mp4")
# except Exception as e:
#     print(f"\nError saving animation: {e}")
#     print("Ensure ffmpeg is installed and accessible in your system's PATH.")
#     print("You might need to install it (e.g., 'conda install ffmpeg' or 'sudo apt install ffmpeg').")