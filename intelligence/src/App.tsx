import { useMemo } from 'react';
import { KEYFRAMES, SANS, C } from './styles';
import { useIntelligence } from './state/useIntelligence';
import {
  deriveRoutingDecisions,
  deriveStats,
  deriveStreamRows,
} from './state/derive';
import { Header } from './components/Header';
import { ConnectionBanner } from './components/ConnectionBanner';
import { RoutingLog } from './components/RoutingLog';
import { SessionStats } from './components/SessionStats';
import { RedisPanel } from './components/RedisPanel';
import { Provenance } from './components/Provenance';

export default function App() {
  const {
    capabilities,
    capDetail,
    health,
    events,
    loaded,
    requestDetail,
  } = useIntelligence();

  const decisions = useMemo(
    () => deriveRoutingDecisions(events, capabilities),
    [events, capabilities],
  );
  const stats = useMemo(() => deriveStats(decisions), [decisions]);
  const streamRows = useMemo(() => deriveStreamRows(events, capabilities), [events, capabilities]);

  const connectionLost =
    !health.reachable || !health.redis || !health.postgres;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: C.pageBg,
        color: C.text,
        fontFamily: SANS,
        fontSize: 14,
        lineHeight: 1.5,
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <style>{KEYFRAMES}</style>
      <Header health={health} />
      <ConnectionBanner visible={connectionLost} />
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 56px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1.4fr 1fr',
            gap: 28,
            alignItems: 'start',
          }}
        >
          <RoutingLog decisions={decisions} stats={stats} loaded={loaded} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
            <SessionStats stats={stats} />
            <RedisPanel
              indexedCount={capabilities.length}
              streamRows={streamRows}
              loaded={loaded}
            />
          </div>
        </div>
        <Provenance
          capabilities={capabilities}
          capDetail={capDetail}
          events={events}
          requestDetail={requestDetail}
          loaded={loaded}
        />
      </div>
    </div>
  );
}
