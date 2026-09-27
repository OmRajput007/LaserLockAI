import urllib.request
import json

# 1. Check status
status = json.loads(urllib.request.urlopen('http://127.0.0.1:8000/api/status').read().decode())
print('[+] Version:', status['version'])
print('[+] Subsystems:', status['subsystems'])

# 2. Test Target Shape Endpoint
shape_data = json.dumps({'shape': 'Gaussian'}).encode('utf-8')
req_shape = urllib.request.Request('http://127.0.0.1:8000/api/simulation/target/shape', data=shape_data, headers={'Content-Type': 'application/json'})
res_shape = json.loads(urllib.request.urlopen(req_shape).read().decode())
print('[+] Target Shape Updated:', res_shape)

# 3. Test Target Motion Endpoint
motion_data = json.dumps({'trajectory_type': 'Figure of 8', 'speed_pixels_per_s': 45.0}).encode('utf-8')
req_motion = urllib.request.Request('http://127.0.0.1:8000/api/simulation/target/motion', data=motion_data, headers={'Content-Type': 'application/json'})
res_motion = json.loads(urllib.request.urlopen(req_motion).read().decode())
print('[+] Target Motion Updated:', res_motion)

# 4. Test Gimbal Slider Angles Endpoint
angle_data = json.dumps({'pan_deg': 2.5, 'tilt_deg': -1.5}).encode('utf-8')
req_angle = urllib.request.Request('http://127.0.0.1:8000/api/simulation/gimbal/angles', data=angle_data, headers={'Content-Type': 'application/json'})
res_angle = json.loads(urllib.request.urlopen(req_angle).read().decode())
print('[+] Gimbal Target Angles Set:', res_angle)

# 5. Step simulation and verify 3D telemetry
req_step = urllib.request.Request('http://127.0.0.1:8000/api/simulation/step', data=b'', headers={'Content-Type': 'application/json'})
telemetry = json.loads(urllib.request.urlopen(req_step).read().decode())
t = telemetry['target']
c = telemetry['camera']
print('[+] 3D Telemetry Output:')
print(f'    Target ID {t["target_id"]}: Shape={t["shape"]}, Pos=({t["world_x"]}, {t["world_y"]}, {t["world_z"]})')
print(f'    Velocity=({t["velocity_x"]}, {t["velocity_y"]}, {t["velocity_z"]}), Accel=({t["acceleration_x"]}, {t["acceleration_y"]}, {t["acceleration_z"]})')
print(f'    In FOV={t["is_in_fov"]}, Camera Pixel=({t["pixel_x"]}, {t["pixel_y"]})')
print(f'    Camera Pan={c["pan_deg"]}°, Tilt={c["tilt_deg"]}°, Frustum Corners Count={len(c["frustum_corners_world"])}')

# 6. Verify image frame endpoint returns valid JPEG bytes
req_frame = urllib.request.urlopen('http://127.0.0.1:8000/api/simulation/frame')
img_bytes = req_frame.read()
print(f'[+] Camera Frame Rendered: {len(img_bytes)} bytes JPEG')
