import React, { useState, useEffect, useCallback } from 'react';
import { Gauge, Zap, Clock } from 'lucide-react';
import { satellitePovSync } from '../simulation/satellitePovSync';

export interface BeaconSpeedControlProps {
  currentSpeed?: number;
  onSpeedChange?: (speedKmh: number) => void;
  speedApplied?: boolean;
  className?: string;
  showPhysicalDetails?: boolean;
}

export const BEACON_SPEED_PRESETS = [
  { label: 'Static', value: 0, tag: 'Static (0)', color: 'text-slate-400' },
  { label: 'Loiter', value: 150, tag: 'Loiter (150)', color: 'text-emerald-400' },
  { label: 'Cruise', value: 600, tag: 'Cruise (600)', color: 'text-cyan-400' },
  { label: 'Max', value: 1200, tag: 'Max (1200)', color: 'text-rose-400' },
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
    <div className={`bg-slate-900/80 border border-slate-800 rounded-lg p-3 font-mono text-xs ${className}`}>
      {/* Header with Title and Real-time Badge */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-cyan-400 font-bold uppercase tracking-wider">
          <Gauge className="w-4 h-4" />
          <span>Beacon Speed Control</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded transition border ${
              isAppliedState
                ? 'bg-emerald-900/80 text-emerald-300 border-emerald-700 shadow-sm'
                : 'bg-slate-800/90 text-cyan-300 border-slate-700 font-mono'
            }`}
          >
            {isAppliedState ? '✓ APPLIED' : `${localSpeed} km/h`}
          </span>
        </div>
      </div>

      {/* Speed Presets */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-slate-400 text-[10px]">Presets:</span>
        {BEACON_SPEED_PRESETS.map(({ label, value, tag, color }) => {
          const isActive = localSpeed === value;
          return (
            <button
              key={label}
              onClick={() => handleSpeedCommit(value)}
              className={`px-2.5 py-1 rounded text-[10px] font-bold border transition ${
                isActive
                  ? 'bg-slate-700 border-cyan-500 shadow-sm shadow-cyan-950 ' + color
                  : 'bg-slate-800/90 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
              }`}
            >
              {tag}
            </button>
          );
        })}
      </div>

      {/* Live Slider Control */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1 text-slate-300">
            <Zap className="w-3 h-3 text-cyan-400" />
            <span>Live Speed Adjustment</span>
          </span>
          <span className="font-mono">
            <span className="text-white font-bold">{localSpeed}</span>
            <span className="text-slate-500"> km/h</span>
            <span className="text-slate-600 ml-2">(range: 0 – 1200)</span>
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
          className="w-full accent-cyan-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
        />

        {/* Range boundary tick labels */}
        <div className="flex justify-between text-[10px] text-slate-500 font-mono">
          <span>0 km/h (Static)</span>
          <span>600 km/h (Cruise)</span>
          <span>1200 km/h (Max)</span>
        </div>
      </div>

      {/* Physically Grounded Specifications Footnote */}
      {showPhysicalDetails && (
        <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[9.5px] text-slate-400 flex-wrap gap-1">
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-cyan-400/80" />
            <span>Earth 1-Rev (Circumference 40,075 km):</span>
          </span>
          <span className="font-mono font-bold text-cyan-300">
            {formatBeaconRevolutionTime(localSpeed)}
          </span>
        </div>
      )}
    </div>
  );
};

export default BeaconSpeedControl;
