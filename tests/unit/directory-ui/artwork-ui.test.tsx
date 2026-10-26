/**
 * The illustration in the directory panel, the details panel, the palette and
 * the mobile peek, on the committed dataset and manifest. Labels are
 * shown exactly as printed; status wording is "Verified link to the illustration" / "Unconfirmed
 * match" / "Not linked to a map building"; artwork-only items are never routed.
 */
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../../src/app/store/index.ts';
import { DirectoryPanel, DirectoryPeek } from '../../../src/components/directory/index.ts';
import { NO_OFFICIAL_IDENTITY } from '../../../src/components/place/artwork-format.ts';
import { PlaceDetails } from '../../../src/components/place/index.ts';
import { buildResultSections } from '../../../src/components/search/palette-model.ts';
import { renderWithAtlas, resetAppStore } from '../app/render-helpers.tsx';
import { artServices, CANDIDATE_25, VERIFIED_25 } from '../directory/artwork-fixtures.ts';

afterEach(() => {
  cleanup();
  resetAppStore();
});

const rowButtons = () => screen.getAllByRole('button').filter((b) => b.closest('li'));

describe('DirectoryPanel with the illustration', () => {
  it('groups by the printed captions exactly, with status and the not-routable note', () => {
    renderWithAtlas(<DirectoryPanel />, artServices());
    fireEvent.click(screen.getByRole('radio', { name: 'Illustration' }));
    expect(screen.getByText(/Grouped as the illustration prints its blocks/)).toBeInTheDocument();
    const heading = screen.getByRole('heading', { name: /BLOCK- 48, 49/ });
    expect(heading).toHaveTextContent('Caption printed on the illustration: BLOCK- 48, 49 (2)');
    const section = heading.closest('section')!;
    const img = within(section).getByRole('img');
    expect(img.getAttribute('src')).toMatch(/isometric-art\/original\/67-lpu-isometric-map-design-\d+\.png$/);
    const rows = within(section).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('.font-medium')!.textContent)).toEqual([
      'BOYS HOSTEL -2, 3',
      'BOYS HOSTEL -2, 3',
    ]);
    expect(rows[0]).toHaveTextContent('Unconfirmed match');
    expect(rows[0]).toHaveTextContent('Not routable');
    expect(rows[0]).toHaveTextContent('Number 48 on the illustration');
    // The illustration filter lists the index sections printed on the overview.
    const select = screen.getByLabelText('Section on the illustration');
    expect(within(select).getByRole('option', { name: /^EDUCATION \(\d+\)$/ })).toBeInTheDocument();
  });

  it('selecting an artwork-only row selects its art: id and opens its details', () => {
    renderWithAtlas(<DirectoryPanel />, artServices());
    fireEvent.click(screen.getByRole('radio', { name: 'Illustration' }));
    const row = rowButtons().find((b) => b.textContent?.includes('Number 56 on the illustration'))!;
    fireEvent.click(row);
    expect(useAppStore.getState().selectedPlaceId).toBe('art:num-56');
    expect(useAppStore.getState().activePanel).toBe('details');
    // Framed by the illustration only: no map mode has a position for an art: id.
    expect(useAppStore.getState().focusRequest).toMatchObject({ kind: 'place', placeId: 'art:num-56' });
  });

  it('search finds artwork items by number in the default grouping, after the map buildings', () => {
    renderWithAtlas(<DirectoryPanel />, artServices());
    fireEvent.change(screen.getByLabelText('Search buildings or map keys'), {
      target: { value: 'Block 25' },
    });
    const art = screen.getByRole('heading', { name: /On the campus illustration/ });
    const rows = within(art.closest('section')!).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('SCHOOL OF AGRICULTURE');
    expect(rows[0]).toHaveTextContent('Number 25 on the illustration');
  });

  it('a verified item is listed as its building row inside its caption group', () => {
    renderWithAtlas(<DirectoryPanel />, artServices([VERIFIED_25]));
    fireEvent.click(screen.getByRole('radio', { name: 'Illustration' }));
    const section = screen.getByRole('heading', { name: /BLOCK-25,26:/ }).closest('section')!;
    const rows = within(section).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Verified link to the illustration');
    expect(rows[0]).toHaveTextContent('On the illustration: SCHOOL OF AGRICULTURE');
    fireEvent.click(rows[0]!);
    expect(useAppStore.getState().selectedPlaceId).toBe(CANDIDATE_25);
  });
});

describe('details of an illustration item', () => {
  it('shows exact labels, no official identity, the stable id, the status and the unconfirmed candidate', () => {
    const s = artServices();
    renderWithAtlas(<PlaceDetails placeId="art:num-56" />, s);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('SCHOOL OF CIVIL INGNEERING');
    expect(screen.getByText('BLOCK- 56')).toBeInTheDocument();
    expect(screen.getByText(NO_OFFICIAL_IDENTITY)).toBeInTheDocument();
    expect(screen.getByText('art:num-56')).toBeInTheDocument();
    expect(screen.getAllByText('Not linked to a map building').length).toBeGreaterThan(0);
    expect(screen.getByText(/not linked to a verified map building/)).toBeInTheDocument();
    expect(screen.getByText(/SCHOOL OF CIVIL ENGINEERING \(search spellings only/)).toBeInTheDocument();
    cleanup();

    renderWithAtlas(<PlaceDetails placeId="art:num-25" />, s);
    const candidate = s.buildingDirectory.byId.get(CANDIDATE_25)!;
    expect(
      screen.getByText(new RegExp(`${candidate.title}.*not selected, not used for directions`)),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show the candidate on the map' }));
    // Framed, never selected.
    expect(useAppStore.getState().selectedPlaceId).toBeNull();
    expect(useAppStore.getState().focusRequest).toMatchObject({ kind: 'place', placeId: CANDIDATE_25 });
  });

  it('keeps double spaces of a printed caption', () => {
    renderWithAtlas(<PlaceDetails placeId="art:num-2" />, artServices());
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(
      'CAMPUS CAFE  & BALDEV RAJ AUDITORIUM',
    );
  });

  it('never shows a held label or its vignette', () => {
    renderWithAtlas(<PlaceDetails placeId="art:scene-103" />, artServices());
    expect(document.body.textContent).not.toMatch(/DILDO/i);
    expect(screen.getByText(/withheld until the owner has reviewed it/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('a building shows its verified labels with evidence, its candidates, and its identity', () => {
    const s = artServices([VERIFIED_25]);
    renderWithAtlas(<PlaceDetails placeId={CANDIDATE_25} />, s);
    const section = screen.getByRole('region', { name: 'On the campus illustration' });
    expect(within(section).getByText('Verified link to the illustration')).toBeInTheDocument();
    // The verified caption (25) and the candidate button of 26, which shares the printed caption.
    expect(within(section).getAllByText('SCHOOL OF AGRICULTURE')).toHaveLength(2);
    expect(within(section).getByRole('button', { name: 'SCHOOL OF AGRICULTURE' })).toBeInTheDocument();
    expect(within(section).getByText(/Test fixture: sign photographed on site/)).toBeInTheDocument();
    expect(within(section).getByText(/Unconfirmed match\./)).toBeInTheDocument();
    expect(
      within(section).getByRole('button', { name: 'SCHOOL OF CHEMICAL ENGINEERING AND PHYSICAL SCIENCE' }),
    ).toBeInTheDocument();
    const identity = screen.getByRole('region', { name: 'Identity' });
    expect(identity).toHaveTextContent(`Stable id: ${CANDIDATE_25}`);
    expect(identity).toHaveTextContent('Official block number: none recorded');
  });
});

describe('palette and peek', () => {
  it('lists artwork hits in their own section, never routable', () => {
    const s = artServices();
    const sections = buildResultSections(s.searchIndex.search('Block 48'), {
      listMode: false,
      getPlace: s.getPlace,
    });
    const art = sections.find((x) => x.id === 'illustration')!;
    expect(art.label).toBe('On the campus illustration');
    expect(art.items[0]).toMatchObject({
      kind: 'artwork',
      ref: 'art:num-48',
      noLocation: true,
      icon: 'overview',
    });
  });

  it('the peek shows a selected illustration item by its exact title', () => {
    const s = artServices();
    useAppStore.setState({ selectedPlaceId: 'art:num-9' });
    renderWithAtlas(<DirectoryPeek onBrowse={() => {}} />, s);
    expect(screen.getByText('GIRLS HOSTAL 1, 2, 3, 4')).toBeInTheDocument();
    expect(screen.getByText('Number 9 on the illustration')).toBeInTheDocument();
  });

  it('the peek keeps a printed double space visible (white-space: pre, still one line)', () => {
    const s = artServices();
    useAppStore.setState({ selectedPlaceId: 'art:num-2' });
    renderWithAtlas(<DirectoryPeek onBrowse={() => {}} />, s);
    const title = screen.getByText('CAMPUS CAFE  & BALDEV RAJ AUDITORIUM', { normalizer: (t) => t });
    expect(title.className.split(' ')).toContain('whitespace-pre');
  });
});
