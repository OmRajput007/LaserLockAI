/**
 * HandoverPanel.tsx
 * =================
 * Compact HUD panel showing real-time satellite handover status.
 *
 * Displays:
 *  - Active satellite index + backup satellite index
 *  - Current handover state (IDLE / TRANSFERRING / NO_COVERAGE)
 *  - Link state badge (LINK_OK / LINK_BLOCKED / NO_COVERAGE)
 *  - Backup acquisition progress bar
 *  - Cumulative metrics (count, successes, NO_COVERAGE time)
 *  - Per-event log (last 5 events)
 *
 * Usage:
 *   import HandoverPanel from './HandoverPanel';
 *   <HandoverPanel handover={telemetry.handover} />
 */

import React from 'react';
import { Radio, Satellite, AlertTriangle, CheckCircle, XCircle, Activity, Clock } from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface HandoverMetrics {
  handover_count:           number;
  successful_handovers:     number;
  failed_handovers:         number;
  no_coverage_events:       number;
  total_no_coverage_s:      number;
  mean_acquisition_time_s:  number | null;
}

interface HandoverData {
  active_sat_index:         number;
  backup_sat_index:         number;
  state:                    string;
  link_state:               string;
  pat_badge:                string;
  active_vis_can_see:       boolean;
  active_vis_el_deg:        number;
  active_vis_az_deg:        number;
  active_range_km:          number;
  backup_vis_can_see:       boolean;
  backup_vis_el_deg:        number;
  backup_vis_az_deg:        number;
  backup_range_km:          number;
  backup_acquire_progress:  number;
  will_lose_soon:           boolean;
  metrics:                  HandoverMetrics;
  sim_time_s:               number;
}

interface HandoverPanelProps {
  handover: HandoverData | null | undefined;
  backupAcquireSteps?: number;  // default 3
}

// ── Colour helpers ────────────────────────────────────────────────────────────

const stateColor = (state: string) => {
  switch (state) {
    case 'IDLE':         return '#22c55e'; // green
    case 'TRANSFERRING': return '#f59e0b'; // amber
    case 'NO_COVERAGE':  return '#ef4444'; // red
    default:             return '#94a3b8'; // slate
  }
};

const linkColor = (ls: string) => {
  if (ls === 'LINK_OK')      return '#22c55e';
  if (ls === 'NO_COVERAGE')  return '#ef4444';
  return '#f59e0b'; // LINK_BLOCKED
};

const BadgeIcon = ({ state }: { state: string }) => {
  if (state === 'LINK_OK' || state === 'IDLE')
    return <CheckCircle size={12} style={{ color: '#22c55e', display: 'inline', marginRight: 3 }} />;
  if (state === 'NO_COVERAGE')
    return <XCircle size={12} style={{ color: '#ef4444', display: 'inline', marginRight: 3 }} />;
  return <AlertTriangle size={12} style={{ color: '#f59e0b', display: 'inline', marginRight: 3 }} />;
};

// ── Component ────────────────────────────────────────────────────────────────

const HandoverPanel: React.FC<HandoverPanelProps> = ({ handover, backupAcquireSteps = 3 }) => {
  if (!handover) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <Radio size={13} style={{ marginRight: 5 }} />
          <span style={styles.title}>Handover</span>
          <span style={{ ...styles.badge, background: '#334155' }}>DISABLED</span>
        </div>
        <p style={styles.dimText}>Enable handover via Settings → Orbital → Handover Config</p>
      </div>
    );
  }

  const m = handover.metrics;
  const progressPct = Math.min(100, (handover.backup_acquire_progress / backupAcquireSteps) * 100);

  return (
    <div style={styles.container}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <Radio size={13} style={{ marginRight: 5, color: '#38bdf8' }} />
        <span style={styles.title}>Satellite Handover</span>
        <span style={{ ...styles.badge, background: stateColor(handover.state) + '33', border: `1px solid ${stateColor(handover.state)}`, color: stateColor(handover.state) }}>
          {handover.state}
        </span>
      </div>

      {/* ── Active / Backup row ── */}
      <div style={styles.row}>
        <SatBlock
          label="ACTIVE"
          idx={handover.active_sat_index}
          canSee={handover.active_vis_can_see}
          el={handover.active_vis_el_deg}
          az={handover.active_vis_az_deg}
          range={handover.active_range_km}
          willLose={handover.will_lose_soon}
          color="#38bdf8"
        />
        <div style={styles.arrowCol}>
          {handover.state === 'TRANSFERRING'
            ? <div style={{ color: '#f59e0b', fontSize: 18, fontWeight: 700 }}>⇒</div>
            : <div style={{ color: '#475569', fontSize: 16 }}>⇒</div>}
        </div>
        <SatBlock
          label="BACKUP"
          idx={handover.backup_sat_index}
          canSee={handover.backup_vis_can_see}
          el={handover.backup_vis_el_deg}
          az={handover.backup_vis_az_deg}
          range={handover.backup_range_km}
          willLose={false}
          color="#818cf8"
        />
      </div>

      {/* ── Link state ── */}
      <div style={styles.linkRow}>
        <BadgeIcon state={handover.link_state} />
        <span style={{ color: linkColor(handover.link_state), fontSize: 11, fontWeight: 600 }}>
          {handover.link_state}
        </span>
        {handover.will_lose_soon && (
          <span style={{ marginLeft: 8, color: '#f59e0b', fontSize: 10 }}>
            ⚠ Loss predicted
          </span>
        )}
      </div>

      {/* ── Transfer progress bar ── */}
      {handover.state === 'TRANSFERRING' && (
        <div style={{ marginTop: 6 }}>
          <div style={styles.dimText}>Backup acquisition: {handover.backup_acquire_progress}/{backupAcquireSteps}</div>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* ── Metrics ── */}
      <div style={styles.metricsGrid}>
        <MetricCell label="Handovers" value={m.handover_count} />
        <MetricCell label="Succeeded" value={m.successful_handovers} color="#22c55e" />
        <MetricCell label="Failed" value={m.failed_handovers} color={m.failed_handovers > 0 ? '#ef4444' : undefined} />
        <MetricCell label="No Coverage" value={`${m.total_no_coverage_s.toFixed(1)}s`} color={m.total_no_coverage_s > 0 ? '#f59e0b' : undefined} />
        {m.mean_acquisition_time_s != null && (
          <MetricCell label="Mean Acq." value={`${m.mean_acquisition_time_s.toFixed(2)}s`} />
        )}
      </div>
    </div>
  );
};

// ── Sub-components ────────────────────────────────────────────────────────────

interface SatBlockProps {
  label: string;
  idx: number;
  canSee: boolean;
  el: number;
  az: number;
  range: number;
  willLose: boolean;
  color: string;
}

const SatBlock: React.FC<SatBlockProps> = ({ label, idx, canSee, el, az, range, willLose, color }) => (
  <div style={{ flex: 1, background: '#0f172a', borderRadius: 6, padding: '5px 7px', border: `1px solid ${color}33` }}>
    <div style={{ fontSize: 9, color, fontWeight: 700, letterSpacing: 1 }}>{label} SAT-{idx + 1}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
      <Satellite size={12} style={{ color: canSee ? color : '#ef4444' }} />
      <span style={{ fontSize: 10, color: canSee ? '#e2e8f0' : '#ef4444' }}>
        {canSee ? 'VISIBLE' : 'NO LOS'}
      </span>
    </div>
    <div style={{ fontSize: 9, color: '#64748b', marginTop: 2 }}>
      El {el.toFixed(1)}° · Az {az.toFixed(1)}°
    </div>
    <div style={{ fontSize: 9, color: '#64748b' }}>
      {range.toFixed(0)} km
    </div>
    {willLose && <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 2 }}>⚠ Loss predicted</div>}
  </div>
);

const MetricCell: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
  <div style={{ textAlign: 'center', padding: '3px 4px', background: '#0f172a', borderRadius: 4 }}>
    <div style={{ fontSize: 9, color: '#64748b' }}>{label}</div>
    <div style={{ fontSize: 12, fontWeight: 700, color: color || '#e2e8f0' }}>{value}</div>
  </div>
);

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'rgba(15, 23, 42, 0.92)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(56, 189, 248, 0.25)',
    borderRadius: 10,
    padding: '10px 12px',
    color: '#e2e8f0',
    fontFamily: "'JetBrains Mono', 'Courier New', monospace",
    minWidth: 260,
    maxWidth: 340,
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 8,
    gap: 4,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    color: '#38bdf8',
    letterSpacing: 1,
    flex: 1,
  },
  badge: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 1,
    padding: '2px 6px',
    borderRadius: 4,
    border: '1px solid transparent',
  },
  row: {
    display: 'flex',
    gap: 6,
    marginBottom: 6,
  },
  arrowCol: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    flexShrink: 0,
  },
  linkRow: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 4,
    fontSize: 11,
  },
  progressTrack: {
    height: 4,
    background: '#1e293b',
    borderRadius: 2,
    marginTop: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    background: '#f59e0b',
    borderRadius: 2,
    transition: 'width 0.3s',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 4,
    marginTop: 8,
  },
  dimText: {
    fontSize: 9,
    color: '#475569',
  },
};

export default HandoverPanel;
