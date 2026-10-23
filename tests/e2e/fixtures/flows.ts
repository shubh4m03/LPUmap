/** Multi-step user flows shared by several specs. */
import { expect } from '@playwright/test';
import { escapeRegExp, type Atlas } from './atlas.ts';
import type { LocatedPlace } from './data.ts';

/** Opens the destination's details, chooses "Directions to here", then searches the start. */
export async function planRoute(atlas: Atlas, from: LocatedPlace, to: LocatedPlace): Promise<void> {
  const { page } = atlas;
  await atlas.open({ place: to.id });
  await atlas.placeArticle(to.name).getByRole('button', { name: 'Directions to here' }).click();
  const directions = atlas.panel('Directions');
  await expect(directions.getByRole('region', { name: 'Destination' })).toContainText(to.displayName);
  const startSearch = directions.getByRole('combobox', { name: 'Search for the start' });
  await startSearch.fill(from.name);
  const option = page
    .getByRole('listbox', { name: 'Places for the start' })
    .getByRole('option', { name: new RegExp(`^${escapeRegExp(from.name)}`) })
    .first();
  await option.click();
  await expect(directions.getByRole('region', { name: 'Start' })).toContainText(from.displayName);
  await expect(directions.getByTestId('route-summary').or(directions.getByRole('alert'))).toBeVisible();
}
