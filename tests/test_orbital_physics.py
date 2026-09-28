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
