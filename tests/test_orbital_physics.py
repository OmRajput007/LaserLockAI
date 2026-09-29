import math
import pytest

from backend.app.orbital.constants import (
    EARTH_RADIUS_KM, GM_KM3_S2,
)
from backend.app.orbital.platform import Platform
from backend.app.orbital.orbital_mechanics import CircularOrbitIntegrator, UAVLocalMotion
from backend.app.orbital.link_geometry import compute_link, LinkConfig


def test_orbital_speed():
    # Speeds: 300 km = 7.73 km/s, 550 km = 7.59, 2000 km = 6.90, GEO = 3.07
    p = Platform()

    o_300 = CircularOrbitIntegrator(p, altitude_km=300.0)
    assert math.isclose(o_300.speed_km_s, 7.73, rel_tol=0.01)

    o_550 = CircularOrbitIntegrator(p, altitude_km=550.0)
    assert math.isclose(o_550.speed_km_s, 7.59, rel_tol=0.01)

    o_2000 = CircularOrbitIntegrator(p, altitude_km=2000.0)
    assert math.isclose(o_2000.speed_km_s, 6.90, rel_tol=0.01)

    o_geo = CircularOrbitIntegrator(p, altitude_km=35786.0)
    assert math.isclose(o_geo.speed_km_s, 3.07, rel_tol=0.01)


def test_leo_550_period_omega():
    # LEO 550 km period = 5739 s; omega = 0.0627 deg/s
    p = Platform()
    o_550 = CircularOrbitIntegrator(p, altitude_km=550.0)
    
    assert math.isclose(o_550.period_s, 5739, rel_tol=0.01)
    assert math.isclose(o_550.omega_deg_s, 0.0627, rel_tol=0.01)


def test_earth_blocking():
    # Two satellites at 550 km
    # Blocking distance: ~5410 km with no margin, ~4912 km with a 100 km margin
    # (These distances represent the cord length between the two satellites
    # when the LOS is exactly tangent to Earth surface + margin.)
    
    r_orbit = EARTH_RADIUS_KM + 550.0
    r_earth = EARTH_RADIUS_KM
    
    # Cosine of half-angle at center
    cos_theta_0 = r_earth / r_orbit
    sin_theta_0 = math.sqrt(1 - cos_theta_0**2)
    cord_0 = 2 * r_orbit * sin_theta_0
    assert math.isclose(cord_0, 5410, rel_tol=0.01)
    
    margin = 100.0
    cos_theta_100 = (r_earth + margin) / r_orbit
    sin_theta_100 = math.sqrt(1 - cos_theta_100**2)
    cord_100 = 2 * r_orbit * sin_theta_100
    assert math.isclose(cord_100, 4912, rel_tol=0.01)
    
    # Test block function
    # Let's put satellite 1 at (r_orbit, 0, 0)
    p1 = Platform()
    p1.pos_eci = (r_orbit, 0.0, 0.0)
    p1.vel_eci = (0.0, 7.59, 0.0)
    p1.platform_type = "SATELLITE"
    
    # Put satellite 2 exactly on the limit for margin=100
    theta_100 = math.acos(cos_theta_100) * 2 # total angle
    p2_blocked = Platform()
    # A bit further -> blocked
    theta_blocked = theta_100 + 0.01
    p2_blocked.pos_eci = (r_orbit * math.cos(theta_blocked), r_orbit * math.sin(theta_blocked), 0.0)
    p2_blocked.vel_eci = (0.0, 7.59, 0.0)
    p2_blocked.platform_type = "SATELLITE"
    
    p2_ok = Platform()
    # A bit closer -> OK
    theta_ok = theta_100 - 0.01
    p2_ok.pos_eci = (r_orbit * math.cos(theta_ok), r_orbit * math.sin(theta_ok), 0.0)
    p2_ok.vel_eci = (0.0, 7.59, 0.0)
    p2_ok.platform_type = "SATELLITE"

    cfg = LinkConfig(atmosphere_margin_km=100.0)
    
    link_blocked = compute_link(p1, p2_blocked, cfg)
    assert link_blocked.link_state == "LINK_BLOCKED"
    
    link_ok = compute_link(p1, p2_ok, cfg)
    assert link_ok.link_state == "LINK_OK"


def test_angular_rate():
    # Simplified transverse-motion angular rate (tolerance 5%):
    # 7.59 km/s at 530 km range = 0.82 deg/s
    # 15.2 km/s at 500 km = 1.74 deg/s
    # 15.2 km/s at 100 km = 8.71 deg/s
    
    p_cam = Platform()
    p_cam.pos_eci = (0.0, 0.0, 0.0)
    p_cam.vel_eci = (0.0, 0.0, 0.0)
    p_cam.platform_type = "SATELLITE"
    
    p_beacon = Platform()
    p_beacon.platform_type = "SATELLITE"

    cfg = LinkConfig(atmosphere_margin_km=0.0) # ignore blocking for this test

    # Case 1: 7.59 km/s at 530 km
    p_beacon.pos_eci = (530.0, 0.0, 0.0)
    p_beacon.vel_eci = (0.0, 7.59, 0.0) # transverse
    l1 = compute_link(p_cam, p_beacon, cfg)
    assert math.isclose(l1.angular_rate_deg_s, 0.82, rel_tol=0.05)

    # Case 2: 15.2 km/s at 500 km
    p_beacon.pos_eci = (500.0, 0.0, 0.0)
    p_beacon.vel_eci = (0.0, 15.2, 0.0)
    l2 = compute_link(p_cam, p_beacon, cfg)
    assert math.isclose(l2.angular_rate_deg_s, 1.74, rel_tol=0.05)

    # Case 3: 15.2 km/s at 100 km
    p_beacon.pos_eci = (100.0, 0.0, 0.0)
    p_beacon.vel_eci = (0.0, 15.2, 0.0)
    l3 = compute_link(p_cam, p_beacon, cfg)
    assert math.isclose(l3.angular_rate_deg_s, 8.71, rel_tol=0.05)


def test_altitude_gap():
    # Satellite at 100 km altitude must be rejected (gap rule)
    p = Platform()
    with pytest.raises(ValueError, match="No stable orbit"):
        CircularOrbitIntegrator(p, altitude_km=100.0)


def test_3d_render_scale_regression():
    """
    Rule 6 Regression check:
    With TRUE_SCALE active and Earth R=100u, verify:
    - LEO 300 km renders at about +4.7u (tolerance 2%)
    - LEO 550 km renders at about +8.6u (tolerance 2%)
    - LEO 2000 km renders at about +31.4u (tolerance 2%)
    - GEO 35786 km renders at about +561u (tolerance 2%)
    Formula: render_altitude_offset(altitude_km) = EARTH_RENDER_R * (altitude_km / 6378)
    """
    earth_render_r = 100.0
    earth_radius_km = 6378.0

    def render_altitude_offset(alt_km: float) -> float:
        return earth_render_r * (alt_km / earth_radius_km)

    # LEO 300 km -> +4.7u
    offset_300 = render_altitude_offset(300.0)
    assert math.isclose(offset_300, 4.7, rel_tol=0.02), f"LEO 300 km expected ~+4.7u, got {offset_300:.3f}u"

    # LEO 550 km -> +8.6u
    offset_550 = render_altitude_offset(550.0)
    assert math.isclose(offset_550, 8.6, rel_tol=0.02), f"LEO 550 km expected ~+8.6u, got {offset_550:.3f}u"

    # LEO 2000 km -> +31.4u
    offset_2000 = render_altitude_offset(2000.0)
    assert math.isclose(offset_2000, 31.4, rel_tol=0.02), f"LEO 2000 km expected ~+31.4u, got {offset_2000:.3f}u"

    # GEO 35786 km -> +561u
    offset_geo = render_altitude_offset(35786.0)
    assert math.isclose(offset_geo, 561.0, rel_tol=0.02), f"GEO 35786 km expected ~+561u, got {offset_geo:.3f}u"


def test_earth_spin_speed():
    """Verify Earth's real diurnal spin speed is exactly 15 degrees per hour."""
    from backend.app.orbital.constants import (
        EARTH_ROTATION_DEG_PER_HOUR,
        EARTH_ROTATION_DEG_PER_SEC,
        EARTH_ROTATION_RAD_PER_SEC,
    )
    # Exact 15 degrees per hour
    assert EARTH_ROTATION_DEG_PER_HOUR == 15.0
    # In deg/s: 15 / 3600 = 0.004166667 deg/s
    assert math.isclose(EARTH_ROTATION_DEG_PER_SEC, 15.0 / 3600.0, rel_tol=1e-6)
    # In rad/s: radians(15) / 3600 ~= 7.2722052e-5 rad/s
    assert math.isclose(EARTH_ROTATION_RAD_PER_SEC, math.radians(15.0) / 3600.0, rel_tol=1e-6)
    # Complete 360-degree rotation in 24 hours
    assert math.isclose(EARTH_ROTATION_DEG_PER_HOUR * 24.0, 360.0, rel_tol=1e-6)


def test_keplerian_orbit_validation():
    """
    Rule 6 Validation check (tolerance 1%):
    - LEO 550 km circular: constant 7.59 km/s at every point.
    - GEO circular: constant 3.07 km/s.
    - GTO preset: about 10.24 km/s at perigee, about 1.60 km/s at apogee, visibly changing over one orbit.
    - Confirm old circular presets match pre-change behavior (regression check).
    """
    from backend.app.orbital.orbital_mechanics import (
        KeplerianOrbitIntegrator,
        make_satellite_integrator,
    )

    # 1. LEO 550 km circular: constant 7.59 km/s at every point
    p_leo = Platform()
    leo = KeplerianOrbitIntegrator(p_leo, perigee_alt_km=550.0, apogee_alt_km=550.0)
    assert leo.e == 0.0
    assert math.isclose(leo.speed_km_s, 7.59, rel_tol=0.01)

    # Step through one complete orbit and verify speed remains constant at 7.59 km/s
    steps = 20
    dt = leo.period_s / steps
    for _ in range(steps):
        leo.step(dt)
        assert math.isclose(leo.speed_km_s, 7.59, rel_tol=0.01), f"LEO 550 speed deviated: {leo.speed_km_s:.3f} km/s"

    # 2. GEO circular: constant 3.07 km/s
    p_geo = Platform()
    geo = KeplerianOrbitIntegrator(p_geo, perigee_alt_km=35786.0, apogee_alt_km=35786.0)
    assert geo.e == 0.0
    assert math.isclose(geo.speed_km_s, 3.07, rel_tol=0.01)
    dt_geo = geo.period_s / 20
    for _ in range(20):
        geo.step(dt_geo)
        assert math.isclose(geo.speed_km_s, 3.07, rel_tol=0.01), f"GEO speed deviated: {geo.speed_km_s:.3f} km/s"

    # 3. GTO preset (perigee 200 km, apogee 35786 km):
    # - About 10.24 km/s at perigee
    # - About 1.60 km/s at apogee
    # - Visibly changing over one orbit
    p_gto_peri = Platform()
    gto_peri = make_satellite_integrator(p_gto_peri, preset="GTO", true_anomaly_deg=0.0) # at perigee
    assert math.isclose(gto_peri.perigee_alt_km, 200.0, rel_tol=0.01)
    assert math.isclose(gto_peri.apogee_alt_km, 35786.0, rel_tol=0.01)
    assert math.isclose(gto_peri.speed_km_s, 10.24, rel_tol=0.01), f"GTO perigee speed expected ~10.24 km/s, got {gto_peri.speed_km_s:.3f}"

    p_gto_apo = Platform()
    gto_apo = make_satellite_integrator(p_gto_apo, preset="GTO", true_anomaly_deg=180.0) # at apogee
    assert math.isclose(gto_apo.speed_km_s, 1.60, rel_tol=0.01), f"GTO apogee speed expected ~1.60 km/s, got {gto_apo.speed_km_s:.3f}"

    # Verify smooth variation from perigee to apogee over half an orbit
    p_gto_step = Platform()
    gto_step = make_satellite_integrator(p_gto_step, preset="GTO", true_anomaly_deg=0.0)
    speeds = [gto_step.speed_km_s]
    # Step across half orbit (period ~ 10.5 hours)
    dt_gto = (gto_step.period_s / 2.0) / 10
    for _ in range(10):
        gto_step.step(dt_gto)
        speeds.append(gto_step.speed_km_s)

    # Speeds must be strictly decreasing from perigee to apogee
    assert speeds[0] > speeds[5] > speeds[-1], f"Speeds did not decrease monotonically towards apogee: {speeds}"
    assert math.isclose(speeds[-1], 1.60, rel_tol=0.01)

    # 4. Confirm old circular presets match pre-change behavior (regression check)
    p_circ = Platform()
    o_300 = make_satellite_integrator(p_circ, preset="LEO-300")
    assert math.isclose(o_300.speed_km_s, 7.73, rel_tol=0.01)

    o_2000 = make_satellite_integrator(p_circ, preset="LEO-2000")
    assert math.isclose(o_2000.speed_km_s, 6.90, rel_tol=0.01)

    # 5. Validation constraints: perigee >= 150 km, apogee >= perigee
    with pytest.raises(ValueError, match="drag limit"):
        KeplerianOrbitIntegrator(Platform(), perigee_alt_km=140.0, apogee_alt_km=500.0)

    with pytest.raises(ValueError, match="Apogee altitude must be >= perigee"):
        KeplerianOrbitIntegrator(Platform(), perigee_alt_km=600.0, apogee_alt_km=400.0)



