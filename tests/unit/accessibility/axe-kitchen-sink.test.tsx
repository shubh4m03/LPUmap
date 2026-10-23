import { act, cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveRegion, SkipLink } from '../../../src/accessibility/index.ts';
import {
  Badge,
  BottomSheet,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Kbd,
  ResultRow,
  SearchInput,
  SegmentedControl,
  SidePanel,
  Skeleton,
  Spinner,
  Switch,
  TextInput,
  ToastProvider,
  ToggleChip,
  VerificationBadge,
  VisuallyHidden,
  useToast,
} from '../../../src/components/ui/index.ts';

afterEach(cleanup);

/**
 * jsdom has no layout engine, so axe's `color-contrast` rule cannot compute colours;
 * token contrast is verified separately in contrast.test.ts. Everything else runs.
 */
const AXE_OPTIONS: axe.RunOptions = { rules: { 'color-contrast': { enabled: false } } };

async function violations(root: Element = document.body) {
  const result = await axe.run(root, AXE_OPTIONS);
  return result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  );
}

function ToastTrigger() {
  const toast = useToast();
  return (
    <Button onClick={() => toast.show({ message: 'Saved to favourites', tone: 'success' })}>Save</Button>
  );
}

function KitchenSink() {
  const [mode, setMode] = useState<'walk' | 'cycle'>('walk');
  const [q, setQ] = useState('lib');
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <ToastProvider>
      <SkipLink targetId="main" />
      <LiveRegion />
      <header>
        <h1>LPU Campus Atlas</h1>
      </header>
      <main id="main">
        <SidePanel title="Search" onClose={() => {}}>
          <SearchInput
            aria-label="Search campus"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onClear={() => setQ('')}
          />
          <TextInput label="Details" hint="Optional" />
          <div role="listbox" aria-label="Search results">
            <ResultRow
              as="option"
              id="opt-1"
              title="Central Library"
              segments={[
                { text: 'Central ', match: false },
                { text: 'Lib', match: true },
                { text: 'rary', match: false },
              ]}
              subtitle="Library & study"
              meta="250 m"
              icon="book"
              active
            />
            <ResultRow as="option" id="opt-2" title="Unnamed building" icon="building" />
          </div>
          <ResultRow title="LPU Ground" icon="ball" subtitle="Sports & fitness" />
          <SegmentedControl
            label="Travel mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'walk', label: 'Walk', icon: 'walk' },
              { value: 'cycle', label: 'Cycle', icon: 'bike' },
            ]}
          />
          <SegmentedControl
            label="Map view"
            iconOnly
            value="2d"
            onChange={() => {}}
            options={[
              { value: '2d', label: '2D map', icon: 'map-2d' },
              { value: '3d', label: '3D buildings', icon: 'cube' },
            ]}
          />
          <ToggleChip pressed onPressedChange={() => {}} icon="utensils">
            Food
          </ToggleChip>
          <ToggleChip pressed={false} onPressedChange={() => {}} icon="droplet">
            Water
          </ToggleChip>
          <Switch
            checked={false}
            onCheckedChange={() => {}}
            label="Save history"
            description="On this device only"
          />
          <Badge tone="accent" icon="star">
            Favourite
          </Badge>
          <VerificationBadge status="imported" />
          <VerificationBadge status="unverified" />
          <Button variant="primary" icon="route" ref={ref}>
            Directions
          </Button>
          <Button variant="danger" icon="trash">
            Clear data
          </Button>
          <Button variant="ghost" loading>
            Locating
          </Button>
          <IconButton icon="locate" label="Show my location" variant="secondary" />
          <Icon name="wheelchair" title="Step-free access unverified" />
          <p>
            Press <Kbd>/</Kbd> to search <VisuallyHidden>(keyboard shortcut)</VisuallyHidden>
          </p>
          <Spinner label="Loading campus data" />
          <Skeleton label="Loading results" />
          <EmptyState
            title="No ATMs mapped on campus"
            description="None are recorded in OpenStreetMap yet."
          />
          <ErrorState message="Could not load data." onRetry={() => {}} />
          <ToastTrigger />
        </SidePanel>
      </main>
    </ToastProvider>
  );
}

describe('axe-core: component kitchen sink', () => {
  it('detects real violations (harness sanity check)', async () => {
    render(
      <main>
        <h1>Broken</h1>
        <button type="button">
          <Icon name="close" />
        </button>
      </main>,
    );
    const found = await violations();
    expect(found.some((v) => v.startsWith('button-name'))).toBe(true);
  });

  it('has no violations', async () => {
    const { getByRole } = render(<KitchenSink />);
    act(() => getByRole('button', { name: 'Save' }).click());
    expect(await violations()).toEqual([]);
  });

  it('has no violations with an open dialog', async () => {
    render(
      <main>
        <h1>Page</h1>
        <Dialog
          open
          onClose={() => {}}
          title="Report a correction"
          description="Describe the problem."
          footer={<Button>Send</Button>}
        >
          <TextInput label="What is wrong?" />
        </Dialog>
      </main>,
    );
    expect(await violations()).toEqual([]);
  });

  it.each(['peek', 'half', 'full'] as const)('has no violations with a bottom sheet at %s', async (snap) => {
    render(
      <main>
        <h1>Map</h1>
        <BottomSheet open onClose={() => {}} title="Central Library" defaultSnap={snap}>
          <p>Library & study</p>
          <Button icon="route">Directions</Button>
        </BottomSheet>
      </main>,
    );
    expect(await violations()).toEqual([]);
  });
});
