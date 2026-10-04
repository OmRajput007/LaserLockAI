import React, { useState, useEffect } from 'react';
import {
  Target,
  Sun,
  Layers,
  Compass,
  Radio,
  MapPin,
  PenTool,
  Globe,
} from 'lucide-react';
import { useSceneSettings } from '../hooks/useSceneSettings';
import { satellitePovSync } from './satellitePovSync';

export const SceneLayersControl: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { settings: _ss, bindSetting: _bindS, set: _setS } = useSceneSettings();

  const [showAtmosphereShells, setShowAtmosphereShells] = [_ss.showAtmosphereShells, _bindS('showAtmosphereShells')];
  const [showReferenceRings, setShowReferenceRings] = [_ss.showReferenceRings, _bindS('showReferenceRings')];
  const [showSunTerminator, setShowSunTerminator] = [_ss.showSunTerminator, _bindS('showSunTerminator')];
  const [showFootprint, setShowFootprint] = [_ss.showFootprint, _bindS('showFootprint')];
  const [beaconRevolving, setBeaconRevolving] = [_ss.beaconRevolving, _bindS('beaconRevolving')];
  const [earthSpinEnabled, setEarthSpinEnabled] = [_ss.earthSpinEnabled, _bindS('earthSpinEnabled')];
  const [pathFollowMode, setPathFollowMode] = [_ss.pathFollowMode, _bindS('pathFollowMode')];

  const [isDrawingPath, setIsDrawingPath] = useState<boolean>(() => Boolean(satellitePovSync.getData().isDrawingPath));
  const [pathMotionActive, setPathMotionActive] = useState<boolean>(() => Boolean(satellitePovSync.getData().pathMotionActive));

  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.isDrawingPath !== undefined) setIsDrawingPath(data.isDrawingPath);
      if (data.pathMotionActive !== undefined) setPathMotionActive(data.pathMotionActive);
      if (data.pathFollowMode !== undefined && data.pathFollowMode !== _ss.pathFollowMode) {
        setPathFollowMode(data.pathFollowMode);
      }
    });
    return unsub;
  }, [_ss.pathFollowMode, setPathFollowMode]);

  const handleToggleBeaconRevolving = () => {
    const next = !beaconRevolving;
    setBeaconRevolving(next);
    satellitePovSync.update({ beaconSpeedKmh: next ? (_ss.beaconSpeedKmh || 150) : 0 });
  };

  const handleTogglePath = () => {
    const next = !pathFollowMode;
    setPathFollowMode(next);
    _setS({ pathFollowMode: next });
    satellitePovSync.update({ pathFollowMode: next });
  };

  const handleToggleDraw = () => {
    const next = !isDrawingPath;
    setIsDrawingPath(next);
    satellitePovSync.update({ isDrawingPath: next });
  };

  const layerItems = [
    {
      id: 'footprint',
      label: 'Footprint',
      status: showFootprint ? 'ON' : 'OFF',
      active: showFootprint,
      onClick: () => setShowFootprint(!showFootprint),
      icon: Target,
      title: showFootprint ? 'Hide Ground Footprint' : 'Show Ground Footprint',
    },
    {
      id: 'sunTerm',
      label: 'Sun/Term',
      status: showSunTerminator ? 'ON' : 'OFF',
      active: showSunTerminator,
      onClick: () => setShowSunTerminator(!showSunTerminator),
      icon: Sun,
      title: showSunTerminator ? 'Hide Sun Vector & Terminator' : 'Show Sun Vector & Terminator',
    },
    {
      id: 'atmo',
      label: 'Atmo',
      status: showAtmosphereShells ? 'ON' : 'OFF',
      active: showAtmosphereShells,
      onClick: () => setShowAtmosphereShells(!showAtmosphereShells),
      icon: Layers,
      title: showAtmosphereShells ? 'Hide Atmosphere Shells' : 'Show Atmosphere Shells',
    },
    {
      id: 'refRings',
      label: 'Ref Rings',
      status: showReferenceRings ? 'ON' : 'OFF',
      active: showReferenceRings,
      onClick: () => setShowReferenceRings(!showReferenceRings),
      icon: Compass,
      title: showReferenceRings ? 'Hide Reference Altitude Rings' : 'Show Reference Altitude Rings',
    },
    {
      id: 'beacon',
      label: 'Beacon',
      status: beaconRevolving ? 'Revolving' : 'Static',
      active: beaconRevolving,
      onClick: handleToggleBeaconRevolving,
      icon: Radio,
      title: beaconRevolving ? 'Put Beacon Static on Ground' : 'Revolve Beacon Around Earth on Ground',
    },
    {
      id: 'pathFollow',
      label: 'Path 1→4',
      status: pathFollowMode ? (pathMotionActive ? 'RUNNING' : 'ON') : 'OFF',
      active: pathFollowMode,
      onClick: handleTogglePath,
      icon: MapPin,
      title: pathFollowMode ? 'Disable 3D Waypoint Path Mode' : 'Enable 3D Waypoint Path Mode (1→4)',
    },
    {
      id: 'draw',
      label: 'Draw',
      status: isDrawingPath ? 'ACTIVE' : 'OFF',
      active: isDrawingPath,
      onClick: handleToggleDraw,
      icon: PenTool,
      title: isDrawingPath ? 'Cancel 3D Path Waypoint Drawing' : 'Click on Earth to add waypoints in 3D',
    },
    {
      id: 'earthSpin',
      label: 'Earth Spin',
      status: earthSpinEnabled ? 'ON' : 'OFF',
      active: earthSpinEnabled,
      onClick: () => setEarthSpinEnabled(!earthSpinEnabled),
      icon: Globe,
      title: earthSpinEnabled ? 'Pause Earth Diurnal Spin' : 'Resume Earth Diurnal Spin',
    },
  ];

  return (
    <div className={`p-3 bg-[#1B1D1A] border-t border-[#33362F] font-mono text-xs ${className}`}>
      <div className="flex items-center justify-between border-b border-[#33362F] pb-1.5 mb-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#F0FFEA] uppercase tracking-wider">
          <Layers className="w-3.5 h-3.5 text-[#FF5F40]" />
          <span>3D Scene & Orbital Layers</span>
        </div>
        <span className="text-[10px] text-[#9CA195] font-mono">{layerItems.length} Controls</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {layerItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={item.title}
              className={`px-2 py-2 rounded border flex flex-col items-center justify-center gap-1 transition select-none ${
                item.active
                  ? 'border-[#FF5F40] bg-[#FF5F40]/15 text-[#F0FFEA] shadow-sm shadow-[#FF5F40]/10 font-medium'
                  : 'bg-[#262824] hover:bg-[#33362F] text-[#9CA195] hover:text-[#F0FFEA] border-[#33362F] hover:border-[#FF5F40]'
              }`}
            >
              <div className="flex items-center gap-1">
                <Icon className={`w-3.5 h-3.5 ${item.active ? 'text-[#FF5F40]' : 'text-[#5E625A]'}`} />
                <span className="text-[11px] font-medium leading-none">{item.label}</span>
              </div>
              <span
                className={`text-[9.5px] px-1.5 py-0.5 rounded leading-none ${
                  item.active ? 'bg-[#FF5F40]/25 text-[#FF5F40] font-bold' : 'bg-[#1B1D1A] text-[#5E625A]'
                }`}
              >
                {item.status}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
