import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, Clock } from 'lucide-react';
import { satellitePovSync } from '../simulation/satellitePovSync';

export interface BeaconSpeedControlProps {
  currentSpeed?: number;
  onSpeedChange?: (speedKmh: number) => void;
  speedApplied?: boolean;
  className?: string;
  showPhysicalDetails?: boolean;
}

export const BEACON_SPEED_PRESETS = [
  { label: 'Static', value: 0, tag: 'Static (0 km/h)' },
  { label: 'Loiter', value: 150, tag: 'Loiter (150 km/h)' },
  { label: 'Cruise', value: 600, tag: 'Cruise (600 km/h)' },
  { label: 'Max', value: 1200, tag: 'Max (1200 km/h)' },
];

/**
 * Calculates physical time for 1 complete revolution around Earth (40,075 km)
 * at the given speed in km/h.
 */
export const formatBeaconRevolutionTime = (speedKmh: number): string => {
  if (speedKmh <= 0) return 'Static (Locked to Ground)';
  const totalSec = (40075.0 / speedKmh) * 3600.0;
  const hours = Math.floor(totalSec / 3600.0);
  const mins = Math.round((totalSec % 3600.0) / 60.0);
  return `${hours}h ${mins}m (${Math.round(totalSec).toLocaleString()}s)`;
};

export const BeaconSpeedControl: React.FC<BeaconSpeedControlProps> = ({
  currentSpeed = 150,
  onSpeedChange,
  speedApplied = false,
  className = '',
  showPhysicalDetails = true,
}) => {
  const [localSpeed, setLocalSpeed] = useState<number>(currentSpeed);
  const [internalApplied, setInternalApplied] = useState<boolean>(false);

  // Sync with prop when parent updates
  useEffect(() => {
    setLocalSpeed(currentSpeed);
  }, [currentSpeed]);

  // Sync with global satellitePovSync
  useEffect(() => {
    const unsub = satellitePovSync.subscribe((data) => {
      if (data.beaconSpeedKmh !== undefined && data.beaconSpeedKmh !== localSpeed) {
        setLocalSpeed(data.beaconSpeedKmh);
      }
    });
    return unsub;
  }, [localSpeed]);

  const handleSpeedCommit = useCallback(
    (speed: number) => {
      setLocalSpeed(speed);
      setInternalApplied(true);
      setTimeout(() => setInternalApplied(false), 800);

      // Broadcast to Three.js simulation engine
      satellitePovSync.update({ beaconSpeedKmh: speed });

      // Notify parent callback if provided
      if (onSpeedChange) {
        onSpeedChange(speed);
      }
    },
    [onSpeedChange]
  );

  const isAppliedState = speedApplied || internalApplied;

  return (
    <div className={`bg-[#0A0D10] border border-[#1F2429] rounded-lg p-3.5 text-xs ${className}`}>
      {/* Header with Title and Real-time Badge */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2 text-slate-200 font-medium">
          <Gauge className="w-4 h-4 text-slate-400" />
          <span>Beacon Velocity Control</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-medium px-2.5 py-0.5 rounded transition border num-mono ${
              isAppliedState
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-700/60'
                : 'bg-[#12161A] text-slate-200 border-[#1F2429]'
            }`}
          >
            {isAppliedState ? 'Applied' : `${localSpeed} km/h`}
          </span>
        </div>
      </div>

      {/* Speed Presets */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-slate-400 text-xs">Presets:</span>
        {BEACON_SPEED_PRESETS.map(({ label, value, tag }) => {
          const isActive = localSpeed === value;
          return (
            <button
              key={label}
              onClick={() => handleSpeedCommit(value)}
              className={`px-2.5 py-1 rounded text-xs font-medium border transition ${
                isActive
                  ? 'bg-[#181D22] text-[#E8EAED] border-[#2D3237]'
                  : 'bg-[#12161A] border-[#1F2429] text-slate-300 hover:text-white hover:bg-[#181D22]'
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {/* Live Slider Control */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-slate-400">
          <span className="text-slate-300">Live Adjustment</span>
          <span className="num-mono text-slate-300">
            <strong className="text-slate-100 font-semibold">{localSpeed}</strong> km/h
            <span className="text-slate-500 ml-1.5">(0 – 1200 km/h)</span>
          </span>
        </div>

        <input
          type="range"
          min={0}
          max={1200}
          step={10}
          value={localSpeed}
          onChange={(e) => {
            const val = Number(e.target.value);
            setLocalSpeed(val);
          }}
          onMouseUp={(e) => handleSpeedCommit(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => handleSpeedCommit(Number((e.target as HTMLInputElement).value))}
          className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-[#12161A] rounded appearance-none"
        />

        {/* Range boundary tick labels */}
        <div className="flex justify-between text-[11px] text-slate-500 num-mono">
          <span>0 km/h (Static)</span>
          <span>600 km/h (Cruise)</span>
          <span>1200 km/h (Max)</span>
        </div>
      </div>

      {/* Physically Grounded Specifications Footnote */}
      {showPhysicalDetails && (
        <div className="mt-2.5 pt-2 border-t border-[#1F2429] flex items-center justify-between text-[11px] text-slate-400 flex-wrap gap-1">
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            <span>Earth 1-Rev (Circumference 40,075 km):</span>
          </span>
          <span className="num-mono font-medium text-slate-300">
            {formatBeaconRevolutionTime(localSpeed)}
          </span>
        </div>
      )}
    </div>
  );
};

export default BeaconSpeedControl;
