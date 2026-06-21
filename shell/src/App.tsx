import { C } from './theme';
import { useForge } from './useForge';
import Header from './components/Header';
import AskBar from './components/AskBar';
import Hero from './components/Hero';
import BuildPanel from './components/BuildPanel';
import ResultsTable from './components/ResultsTable';
import LibraryAside from './components/LibraryAside';
import DetailModal from './components/DetailModal';

export default function App() {
  const f = useForge();

  const toolsForged = f.library.length;
  const totalReuses = f.library.reduce((a, c) => a + (c.reuse_count || 0), 0);
  const showHero = !f.build && !f.results;
  const detailCap = f.detailId
    ? f.library.find((c) => c.id === f.detailId)
    : undefined;

  return (
    <div
      style={{ minHeight: '100vh', padding: '22px 26px 60px', background: C.bg }}
    >
      <div style={{ maxWidth: 1320, margin: '0 auto' }}>
        <Header
          toolsForged={toolsForged}
          totalReuses={totalReuses}
          health={f.health}
          judge={f.judge}
          onToggleJudge={() => f.setJudge(!f.judge)}
        />

        <div
          className="frg-main"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0,1fr) 368px',
            gap: 22,
            alignItems: 'start',
          }}
        >
          <main
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              minWidth: 0,
            }}
          >
            <AskBar
              askText={f.askText}
              year={f.year}
              submitting={f.submitting}
              onAskText={f.setAskText}
              onYear={f.setYear}
              onSubmit={f.startBuild}
            />

            {f.build ? (
              <BuildPanel
                build={f.build}
                judge={f.judge}
                onToggleJudge={() => f.setJudge(!f.judge)}
                onApprove={f.approve}
              />
            ) : null}

            {f.results ? (
              <ResultsTable r={f.results} onOpen={f.openDetail} />
            ) : null}

            {showHero ? <Hero /> : null}
          </main>

          <LibraryAside
            library={f.library}
            runningId={f.runningId}
            onOpen={f.openDetail}
            onRun={f.runSaved}
          />
        </div>
      </div>

      {f.detailId ? (
        <DetailModal
          id={f.detailId}
          fallback={detailCap}
          running={f.runningId === f.detailId}
          onClose={f.closeDetail}
          onRun={f.runSaved}
        />
      ) : null}
    </div>
  );
}
